/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
/**
 * Language Worker
 * This code runs in a WebWorker in the browser. Its main job is to
 * delegate messages it receives to the various handlers that have registered
 * themselves with the worker.
 */
define(function(require, exports, module) {

var oop = require("ace/lib/oop");
var Mirror = require("ace/worker/mirror").Mirror;
var tree = require('treehugger/tree');
var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
var linereport = require("plugins/c9.ide.language.generic.linereport/linereport_base");
var syntaxDetector = require("plugins/c9.ide.language/syntax_detector");
var completeUtil = require("plugins/c9.ide.language/complete_util");
var base_handler = require("./base_handler");
var assert = require("plugins/c9.util/assert");

require("plugins/c9.ide.browsersupport/browsersupport");

var isInWebWorker = typeof window == "undefined" || !window.location || !window.document;

var WARNING_LEVELS = {
    error: 3,
    warning: 2,
    info: 1
};

var UPDATE_TIMEOUT_MIN = 500;
var UPDATE_TIMEOUT_MAX = 10000;
var DEBUG = !isInWebWorker;

// Leaking into global namespace of worker, to allow handlers to have access
/*global disabledFeatures: true*/
disabledFeatures = {};

EventEmitter.once = function(event, fun) {
  var _self = this;
  var newCallback = function() {
    fun && fun.apply(null, arguments);
    _self.removeEventListener(event, newCallback);
  };
  this.addEventListener(event, newCallback);
};

var ServerProxy = function(sender) {

  this.emitter = Object.create(EventEmitter);
  this.emitter.emit = this.emitter._dispatchEvent;

  this.send = function(data) {
      sender.emit("serverProxy", data);
  };

  this.once = function(messageType, messageSubtype, callback) {
    var channel = messageType;
    if (messageSubtype)
       channel += (":" + messageSubtype);
    this.emitter.once(channel, callback);
  };

  this.subscribe = function(messageType, messageSubtype, callback) {
    var channel = messageType;
    if (messageSubtype)
       channel += (":" + messageSubtype);
    this.emitter.addEventListener(channel, callback);
  };

  this.unsubscribe = function(messageType, messageSubtype, f) {
    var channel = messageType;
    if (messageSubtype)
       channel += (":" + messageSubtype);
    this.emitter.removeEventListener(channel, f);
  };

  this.onMessage = function(msg) {
    var channel = msg.type;
    if (msg.subtype)
      channel += (":" + msg.subtype);
    // console.log("publish to: " + channel);
    this.emitter.emit(channel, msg.body);
  };
};

exports.createUIWorkerClient = function() {
    var emitter = Object.create(require("ace/lib/event_emitter").EventEmitter);
    var result = new LanguageWorker(emitter);
    result.on = function(name, f) {
        emitter.on.call(result, name, f);
    };
    result.once = function(name, f) {
        emitter.once.call(result, name, f);
    };
    result.removeEventListener = function(f) {
        emitter.removeEventListener.call(result, f);
    };
    result.call = function(cmd, args, callback) {
        if (callback) {
            var id = this.callbackId++;
            this.callbacks[id] = callback;
            args.push(id);
        }
        this.send(cmd, args);
    };
    result.send = function(cmd, args) {
        setTimeout(function() { result[cmd].apply(result, args); }, 0);
    };
    result.emit = function(event, data) {
        emitter._dispatchEvent.call(emitter, event, data);
    };
    emitter.emit = function(event, data) {
        emitter._dispatchEvent.call(result, event, { data: data });
    };
    result.changeListener = function(e) {
        this.emit("change", {data: [e.data]});
    }; 
    return result;
};

var LanguageWorker = exports.LanguageWorker = function(sender) {
    var _self = this;
    this.handlers = [];
    this.currentMarkers = [];
    this.$lastAggregateActions = {};
    this.$warningLevel = "info";
    this.$openDocuments = {};
    sender.once = EventEmitter.once;
    this.serverProxy = new ServerProxy(sender);

    Mirror.call(this, sender);
    linereport.sender = sender;
    this.setTimeout(0);
    exports.sender = sender;
    exports.$lastWorker = this;

    sender.on("hierarchy", function(event) {
        _self.hierarchy(event);
    });
    sender.on("code_format", function(event) {
        _self.codeFormat();
    });
    sender.on("outline", applyEventOnce(function(event) {
        _self.outline(event);
    }));
    sender.on("complete", applyEventOnce(function(data) {
        _self.complete(data);
    }), true);
    sender.on("documentClose", function(event) {
        _self.documentClose(event);
    });
    sender.on("analyze", applyEventOnce(function(event) {
        _self.analyze(function() {});
    }));
    sender.on("cursormove", function(event) {
        _self.onCursorMove(event);
    });
    sender.on("inspect", applyEventOnce(function(event) {
        _self.inspect(event);
    }));
    sender.on("jumpToDefinition", applyEventOnce(function(event) {
        _self.jumpToDefinition(event);
    }));
    sender.on("isJumpToDefinitionAvailable", applyEventOnce(function(event) {
        _self.isJumpToDefinitionAvailable(event);
    }));
    sender.on("refactorings", function(event) {
        _self.getRefactorings(event);
    });
    sender.on("renamePositions", function(event) {
        _self.getRenamePositions(event);
    });
    sender.on("onRenameBegin", function(event) {
        _self.onRenameBegin(event);
    });
    sender.on("commitRename", function(event) {
        _self.commitRename(event);
    });
    sender.on("onRenameCancel", function(event) {
        _self.onRenameCancel(event);
    });
    sender.on("serverProxy", function(event) {
        _self.serverProxy.onMessage(event.data);
    });
};

/**
 * Ensure that an event handler is called only once if multiple
 * events are received at roughly the same time.
 **/
function applyEventOnce(eventHandler, waitForMirror) {
    var timer;
    var mirror = this;
    return function() {
        var _arguments = arguments;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(function() {
            if (waitForMirror && mirror.isPending())
                return setTimeout(function() { applyEventOnce(eventHandler, true) }, 0);
            eventHandler.apply(eventHandler, _arguments);
        }, 0);
    };
}

oop.inherits(LanguageWorker, Mirror);

var asyncForEach = module.exports.asyncForEach = function(array, fn, callback) {
    array = array.slice(); // copy before use
    function processOne() {
        var item = array.shift();
        fn(item, function processNext(result, err) {
            if (array.length > 0) {
                processOne();
            }
            else if (callback) {
                callback(result, err);
            }
        });
    }
    if (array.length > 0) {
        processOne();
    }
    else if (callback) {
        callback();
    }
}

function asyncParForEach(array, fn, callback) {
    var completed = 0;
    var arLength = array.length;
    if (arLength === 0) {
        callback();
    }
    for (var i = 0; i < arLength; i++) {
        fn(array[i], function(result, err) {
            completed++;
            if (completed === arLength && callback) {
                callback(result, err);
            }
        });
    }
}

(function() {

    this.getLastAggregateActions = function() {
        if(!this.$lastAggregateActions[this.$path])
            this.$lastAggregateActions[this.$path] = {markers: [], hint: null};
        return this.$lastAggregateActions[this.$path];
    };

    this.setLastAggregateActions = function(actions) {
        this.$lastAggregateActions[this.$path] = actions;
    };

    this.enableFeature = function(name) {
        disabledFeatures[name] = false;
    };

    this.disableFeature = function(name) {
        disabledFeatures[name] = true;
    };

    this.setWarningLevel = function(level) {
        this.$warningLevel = level;
    };

    /**
     * Registers a handler by loading its code and adding it the handler array
     */
    this.register = function(path, contents, callback) {
        var _self = this;
        function onRegistered(handler) {
            handler.$source = path;
            handler.proxy = _self.serverProxy;
            handler.sender = _self.sender;
            handler.$isInited = false;
            _self.handlers.push(handler);
            _self.$initHandler(handler, null, true, function() {
                // Note: may not return for a while for asynchronous workers,
                //       don't use this for queueing other tasks
                _self.sender.emit("registered", { path: path });
                callback && callback();
            });
        }
        if (contents) {
            // In the context of this worker, we can't use the standard
            // require.js approach of using <script/> tags to load scripts,
            // but need to load them from the local domain or from text
            // instead. For now, we'll just load external plugins from text;
            // the UI thread'll have to provide them in that format.
            // Note that this indirect eval call evaluates in the (worker)
            // global context.
            try {
                eval.call(null, contents);
            } catch (e) {
                console.error("Could not load language handler " + path + ": " + e);
                _self.sender.emit("registered", { path: path, err: e });
                callback && callback(e);
                throw e;
            }
        }
        var handler;
        try {
            handler = require(path);
            if (!handler)
                throw new Error("Unable to load required module: " + path);
        } catch (e) {
            if (isInWebWorker) {
                console.error("Could not load language handler " + path + ": " + e);
                _self.sender.emit("registered", { path: path, err: e.message });
                callback && callback(e);
                throw e;
            }
            // In ?noworker=1 debugging mode, synchronous require doesn't work
            require([path], function(handler) {
                if (!handler)
                    throw new Error("Could not load language handler " + path, e);
                if (!handler) {
                    _self.sender.emit("registered", { path: path, err: "Could not load" });
                    callback && callback("Could not load");
                    throw new Error("Could not load language handler " + path);
                }
                onRegistered(handler);
            });
            return;
        }
        onRegistered(handler);
    };
    
    this.isHandlerMatch = function(handler, part, ignoreSize) {
        switch (handler.handlesEditor()) {
            case base_handler.HANDLES_EDITOR: 
                if (this.immediateWindow)
                    return;
                break; 
            case base_handler.HANDLES_IMMEDIATE:
                if (!this.immediateWindow)
                    return;
        }
        var docLength = ignoreSize ? null : part
            ? part.getValue().length
            : this.doc.$lines.reduce(function(t,l) { return t + l.length; }, 0);
         return handler.handlesLanguage(part ? part.language : this.$language)
            && (ignoreSize || docLength < handler.getMaxFileSizeSupported());
    };

    this.parse = function(part, callback, allowCached) {
        var _self = this;
        var value = (part || this.doc).getValue();
        var language = part ? part.language : this.$language;

        if (allowCached && this.cachedAsts) {
            var cached = this.cachedAsts[part.index];
            if (cached && cached.ast && cached.part.language === language)
                return callback(cached.ast);
        }

        var resultAst = null;
        asyncForEach(this.handlers, function parseNext(handler, next) {
            if (_self.isHandlerMatch(handler, part)) {
                handler.parse(value, function onParse(ast) {
                    if (ast)
                        resultAst = ast;
                    next();
                });
            }
            else {
                next();
            }
        }, function() {
            callback(resultAst);
        });
    };

    /**
     * Finds the current node using the language handler.
     * This should always be preferred over the treehugger findNode()
     * method.
     * 
     * @param pos.row
     * @param pos.column
     */
    this.findNode = function(ast, pos, callback) {
        if (!ast)
            return callback();

        // Sanity check for old-style pos objects
        assert(!pos.line, "Internal error: providing line/col instead of row/column");
        
        var _self = this;
        var part = syntaxDetector.getContextSyntaxPart(_self.doc, pos, _self.$language);
        var posInPart = syntaxDetector.posToRegion(part.region, pos);
        var result;
        asyncForEach(_self.handlers, function(handler, next) {
            if (_self.isHandlerMatch(handler, part)) {
                handler.findNode(ast, posInPart, function(node) {
                    if (node)
                        result = node;
                    next();
                });
            }
            else {
                next();
            }
        }, function() { callback(result); });
    };

    this.outline = function(event) {
        var _self = this;
        this.getOutline(function(result) {
            _self.sender.emit("outline",
              { body: result && (result.body || result.items) || [] }
            );
        });
    };
    
    this.getOutline = function(callback) {
        var _self = this;
        var result;
        this.parse(null, function(ast) {
            asyncForEach(_self.handlers, function(handler, next) {
                if (_self.isHandlerMatch(handler)) {
                    handler.outline(_self.doc, ast, function(outline) {
                        if (outline && (!result || result.isGeneric))
                            result = outline;
                        
                        next();
                    });
                }
                else
                    next();
            }, function() {
                callback(result);
            });
        });
    };

    this.hierarchy = function(event) {
        var data = event.data;
        var _self = this;
        asyncForEach(this.handlers, function(handler, next) {
            if (_self.isHandlerMatch(handler)) {
                handler.hierarchy(_self.doc, data.pos, function(hierarchy) {
                    if(hierarchy)
                        return _self.sender.emit("hierarchy", hierarchy);
                    else
                        next();
                });
            }
            else
                next();
        });
    };

    this.codeFormat = function() {
        var _self = this;
        asyncForEach(_self.handlers, function(handler, next) {
            if (_self.isHandlerMatch(handler, null, true)) {
                handler.codeFormat(_self.doc, function(newSource) {
                    if (newSource)
                        return _self.sender.emit("code_format", newSource);
                    else
                        next();
                });
            }
            else
                next();
        });
    };

    this.scheduleEmit = function(messageType, data) {
        // todo: sender must set the path
        data.path = this.$path;
        this.sender.emit(messageType, data);
    };

    /**
     * If the program contains a syntax error, the parser will try its best to still produce
     * an AST, although it will contain some problems. To avoid that those problems result in
     * invalid warning, let's filter out warnings that appear within a line or too after the
     * syntax error.
     */
    function filterMarkersAroundError(ast, markers) {
        if (!ast || !ast.getAnnotation)
            return;
        var error = ast.getAnnotation("error");
        if(!error)
            return;
        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i];
            if(marker.type !== 'error' && marker.pos.sl >= error.line && marker.pos.el <= error.line + 2) {
                markers.splice(i, 1);
                i--;
            }
        }
    }

    this.analyze = function(callback) {
        var _self = this;
        var parts = syntaxDetector.getCodeParts(this.doc, this.$language);
        var markers = [];
        var cachedAsts = {};
        asyncForEach(parts, function(part, nextPart) {
            var partMarkers = [];
            _self.parse(part, function(ast) {
                cachedAsts[part.index] = {part: part, ast: ast};

                asyncForEach(_self.handlers, function(handler, next) {
                    if (_self.isHandlerMatch(handler, part)) {
                        handler.language = part.language;
                        handler.analyze(part.getValue(), ast, function(result) {
                            if (result) {
                                handler.getResolutions(part.getValue(), ast, result, function(result2) {
                                    if (result2) {
                                        partMarkers = partMarkers.concat(result2);
                                    } else {
                                        partMarkers = partMarkers.concat(result);
                                    }
                                    next();
                                });
                            }
                            else {
                                next();
                            }
                        });
                    }
                    else {
                        next();
                    }
                }, function () {
                    filterMarkersAroundError(ast, partMarkers);
                    var region = part.region;
                    partMarkers.forEach(function (marker) {
                        if (marker.skipMixed)
                            return;
                        var pos = marker.pos;
                        pos.sl = pos.el = pos.sl + region.sl;
                        if (pos.sl === region.sl) {
                            pos.sc +=  region.sc;
                            pos.ec += region.sc;
                        }
                    });
                    markers = markers.concat(partMarkers);
                    nextPart();
                });
            });
        }, function() {
            var extendedMakers = markers;
            if (_self.getLastAggregateActions().markers.length > 0)
                extendedMakers = markers.concat(_self.getLastAggregateActions().markers);
            _self.cachedAsts = cachedAsts;
            _self.scheduleEmit("markers", _self.filterMarkersBasedOnLevel(extendedMakers));
            _self.currentMarkers = markers;
            callback();
        });
    };
    
    this.checkForMarker = function(pos) {
        var astPos = {line: pos.row, col: pos.column};
        for (var i = 0; i < this.currentMarkers.length; i++) {
            var currentMarker = this.currentMarkers[i];
            if (currentMarker.message && tree.inRange(currentMarker.pos, astPos)) {
                return currentMarker.message;
            }
        }
    };

    this.filterMarkersBasedOnLevel = function(markers) {
        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i];
            if(marker.level && WARNING_LEVELS[marker.level] < WARNING_LEVELS[this.$warningLevel]) {
                markers.splice(i, 1);
                i--;
            }
        }
        return markers;
    };

    this.getPart = function (pos) {
        return syntaxDetector.getContextSyntaxPart(this.doc, pos, this.$language);
    };
    
    /**
     * Request the AST node on the current position
     */
    this.inspect = function (event) {
        var _self = this;
        var pos = { row: event.data.row, column: event.data.column };
        var part = this.getPart({ row: event.data.row, column: event.data.col });
        var partPos = syntaxDetector.posToRegion(part.region, pos);
        this.parse(part, function(ast) {
            _self.findNode(ast, pos, function(node) {
                _self.getPos(node, function(fullPos) {
                    if (!fullPos) {
                        var identifier = completeUtil.retrieveFollowingIdentifier(_self.doc.getLine(pos.row), pos.column);
                        fullPos = { sl: partPos.row, sc: partPos.column, el: partPos.row, ec: partPos.column + identifier.length };
                    }
                    _self.nodeToString(node, function(result) {
                        // Begin with a simple string representation
                        // TODO: remove initial representation, in case handler doesn't want to handle this node?
                        var lastResult = {
                            pos: fullPos,
                            value: result
                        };
                        
                        // Try and find a better match using getInspectExpression()
                        asyncForEach(_self.handlers, function(handler, next) {
                            if (_self.isHandlerMatch(handler, part)) {
                                handler.language = part.language;
                                handler.getInspectExpression(part, ast, partPos, node, function(result) {
                                    if (result) {
                                        result.pos = syntaxDetector.posFromRegion(region, result.pos);
                                        lastResult = result || lastResult;
                                    }
                                    next();
                                });
                            }
                            else {
                                next();
                            }
                        }, function () {
                            _self.scheduleEmit("inspect", lastResult);
                        });
                    });
                });
            });
        }, true);
    };
    
    this.nodeToString = function(node, callback) {
        if (!node)
            return callback();
        var _self = this;
        this.getPos(node, function(pos) {
            if (!pos)
                return callback();
            var doc = _self.doc;
            if (pos.sl === pos.el)
                return callback(doc.getLine(pos.sl).substring(pos.sc, pos.ec));
            
            var result = doc.getLine(pos.sl).substr(pos.sc);
            for (var i = pos.sl + 1; i < pos.el; i++) {
                result += doc.getLine(i);
            }
            result += doc.getLine(pos.el).substr(0, pos.ec);
            callback(result);
        });
    };
    
    this.getPos = function(node, callback) {
        if (!node)
            return callback();
        var done = false;
        var _self = this;
        this.handlers.forEach(function (h) {
            if (!done && _self.isHandlerMatch(h, null, true)) {
                h.getPos(node, function(result) {
                    if (!result)
                        return;
                    done = true;
                    callback(result);
                });
            }
        });
        if (!done)
            callback();
    };
    
    this.getIdentifierRegex = function(pos) {
        var part = this.getPart(pos || { row: 0, column: 0 });
        var result;
        var _self = this;
        this.handlers.forEach(function (h) {
            if (_self.isHandlerMatch(h, part, true))
                result = h.getIdentifierRegex() || result;
        });
        return result || completeUtil.DEFAULT_ID_REGEX;
    };

    /**
     * Process a cursor move. We do way too much here.
     */
    this.onCursorMove = function(event) {
        var pos = event.data.pos;
        var part = this.getPart(pos);
        var line = this.doc.getLine(pos.row);
        
        if (line != event.data.line) {
            // Our intelligence is outdated, tell the client
            return this.scheduleEmit("hint", { line: null });
        }

        var _self = this;
        var hintMessage = ""; // this.checkForMarker(pos) || "";

        var aggregateActions = {markers: [], hint: null, displayPos: null, enableRefactorings: []};
                    
        function processResponse(response) {
            if (response.markers && (!aggregateActions.markers.found || !response.isGeneric)) {
                if (aggregateActions.markers.isGeneric)
                    aggregateActions.markers = [];
                aggregateActions.markers = aggregateActions.markers.concat(response.markers.map(function (m) {
                    var start = syntaxDetector.posFromRegion(part.region, {row: m.pos.sl, column: m.pos.sc});
                    var end = syntaxDetector.posFromRegion(part.region, {row: m.pos.el, column: m.pos.ec});
                    m.pos = {
                        sl: start.row,
                        sc: start.column,
                        el: end.row,
                        ec: end.column
                    };
                    return m;
                }));
                aggregateActions.markers.found = true;
                aggregateActions.markers.isGeneric = response.isGeneric;
            }
            if (response.enableRefactorings && response.enableRefactorings.length > 0) {
                aggregateActions.enableRefactorings = aggregateActions.enableRefactorings.concat(response.enableRefactorings);
            }
            if (response.hint) {
                if (aggregateActions.hint)
                    aggregateActions.hint += "\n" + response.hint;
                else
                    aggregateActions.hint = response.hint;
            }
            if (response.pos)
                aggregateActions.pos = response.pos;
            if (response.displayPos)
                aggregateActions.displayPos = response.displayPos;
        }
        
        function cursorMoved(ast, currentNode, posInPart) {
            asyncForEach(_self.handlers, function(handler, next) {
                if (_self.scheduledUpdate) {
                    // Postpone the cursor move until the update propagates
                    _self.postponedCursorMove = event;
                    return;
                }
                if (_self.isHandlerMatch(handler, part)) {
                    // We send this to several handlers that each handle part of the language functionality,
                    // triggered by the cursor move event
                    asyncForEach(["tooltip", "highlightOccurrences", "onCursorMovedNode"], function(method, nextMethod) {
                        handler[method](part, ast, posInPart, currentNode, function(response) {
                            if (response)
                                processResponse(response);
                            nextMethod();
                        });
                    }, next);
                }
                else {
                    next();
                }
            }, function() {
                if (aggregateActions.hint && !hintMessage) {
                    hintMessage = aggregateActions.hint;
                }
                // TODO use separate events for static and cursor markers
                _self.scheduleEmit("markers", disabledFeatures.instanceHighlight
                    ? []
                    : _self.filterMarkersBasedOnLevel(_self.currentMarkers.concat(aggregateActions.markers)));
                _self.scheduleEmit("enableRefactorings", aggregateActions.enableRefactorings);
                _self.lastCurrentNode = currentNode;
                _self.lastCurrentPos = posInPart;
                _self.setLastAggregateActions(aggregateActions);
                _self.scheduleEmit("hint", {
                    pos: aggregateActions.pos,
                    displayPos: aggregateActions.displayPos,
                    message: hintMessage,
                    line: line
                });
            });

        }

        var posInPart = syntaxDetector.posToRegion(part.region, pos);
        this.parse(part, function(ast) {
            _self.findNode(ast, pos, function(currentNode) {
                if (pos != _self.lastCurrentPos || currentNode !== _self.lastCurrentNode || pos.force) {
                    cursorMoved(ast, currentNode, posInPart);
                }
            });
        }, true);
    };

    this.$getDefinitionDeclarations = function (row, col, callback) {
        var pos = { row: row, column: col };
        var allResults = [];

        var _self = this;
        var part = this.getPart(pos);
        var posInPart = syntaxDetector.posToRegion(part.region, pos);

        this.parse(part, function(ast) {
            _self.findNode(ast, pos, function(currentNode) {
                asyncForEach(_self.handlers, function jumptodefNext(handler, next) {
                    if (_self.isHandlerMatch(handler, part)) {
                        handler.jumpToDefinition(part, ast, posInPart, currentNode, function(results) {
                            handler.path = _self.$path;
                            if (results)
                                allResults = allResults.concat(results);
                            next();
                        });
                    }
                    else {
                        next();
                    }
                }, function () {
                    callback(allResults.map(function (pos) {
                        var globalPos = syntaxDetector.posFromRegion(part.region, pos);
                        pos.row = globalPos.row;
                        pos.column = globalPos.column;
                        return pos;
                    }));
                });
            });
        }, true);
    };

    this.jumpToDefinition = function(event) {
        var _self = this;
        var pos = event.data;
        var line = this.doc.getLine(pos.row);
        var regex = this.getIdentifierRegex();
        var identifier = completeUtil.retrievePrecedingIdentifier(line, pos.column, regex)
            + completeUtil.retrieveFollowingIdentifier(line, pos.column, regex);

        _self.$getDefinitionDeclarations(pos.row, pos.column, function(results) {
            _self.sender.emit(
                "definition",
                {
                    pos: pos,
                    results: results || [],
                    path: _self.$path,
                    identifier: identifier
                }
            );
        });
    };

    this.isJumpToDefinitionAvailable = function(event) {
        var _self = this;
        var pos = event.data;

        _self.$getDefinitionDeclarations(pos.row, pos.column, function(results) {
            _self.sender.emit(
                "isJumpToDefinitionAvailableResult",
                { value: !!(results && results.length), path: _self.$path }
            );
        });
    };
    
    this.getRefactorings = function(event) {
        var _self = this;
        var pos = event.data;
        var part = this.getPart(pos);
        var partPos = syntaxDetector.posToRegion(part.region, pos);
        var result;
        
        this.parse(part, function(ast) {
            _self.findNode(ast, pos, function(currentNode) {
                var result;
                asyncForEach(_self.handlers, function(handler, next) {
                    if (_self.isHandlerMatch(handler, part)) {
                        handler.getRefactorings(part, ast, partPos, currentNode, function(response) {
                            if (response) {
                                assert(!response.enableRefactorings, "Use refactorings instead of enableRefactorings");
                                if (!result || result.isGeneric)
                                    result = response;
                            }
                            next();
                        });
                    }
                    else {
                        next();
                    }
                }, function() {
                    _self.sender.emit("refactoringsResult", result && result.refactorings || []);
                });
            });
        });
    }

    this.getRenamePositions = function(event) {
        var _self = this;
        var pos = event.data;
        var part = this.getPart(pos);
        var partPos = syntaxDetector.posToRegion(part.region, pos);

        function posFromRegion(pos) {
            return syntaxDetector.posFromRegion(part.region, pos);
        }

        this.parse(part, function(ast) {
            _self.findNode(ast, pos, function(currentNode) {
                var result;
                asyncForEach(_self.handlers, function(handler, next) {
                    if (_self.isHandlerMatch(handler, part)) {
                        assert(!handler.getVariablePositions, "handler implements getVariablePositions, should implement getRenamePositions instead");
                        handler.getRenamePositions(part, ast, partPos, currentNode, function(response) {
                            if (response) {
                                if (!result || result.isGeneric)
                                    result = response;
                            }
                            next();
                        });
                    }
                    else {
                        next();
                    }
                }, function() {
                    if (!result)
                        return _self.sender.emit("renamePositionsResult");
                    result.uses = (result.uses || []).map(posFromRegion);
                    result.declarations = (result.declarations || []).map(posFromRegion);
                    result.others = (result.others || []).map(posFromRegion);
                    result.pos = posFromRegion(result.pos);
                    _self.sender.emit("renamePositionsResult", result);
                });
            });
        }, true);
    };

    this.onRenameBegin = function(event) {
        var _self = this;
        this.handlers.forEach(function(handler) {
            if (_self.isHandlerMatch(handler))
                handler.onRenameBegin(_self.doc, function() {});
        });
    };

    this.commitRename = function(event) {
        var _self = this;
        var oldId = event.data.oldId;
        var newName = event.data.newName;
        var isGeneric = event.data.isGeneric;
        var commited = false;
        
        if (oldId.value === newName)
          return this.sender.emit("commitRenameResult", {});

        asyncForEach(this.handlers, function(handler, next) {
            if (_self.isHandlerMatch(handler)) {
                handler.commitRename(_self.doc, oldId, newName, isGeneric, function(response) {
                    if (response) {
                        commited = true;
                        _self.sender.emit("commitRenameResult", { err: response, oldName: oldId.value, newName: newName });
                        // only one handler gets to do this; don't call next();
                    } else {
                        next();
                    }
                });
            }
            else
                next();
            },
            function() {
                if (!commited)
                    _self.sender.emit("commitRenameResult", {});
            }
        );
    };

    this.onRenameCancel = function(event) {
        var _self = this;
        asyncForEach(this.handlers, function(handler, next) {
            if (_self.isHandlerMatch(handler)) {
                handler.onRenameCancel(function() {
                    next();
                });
            }
            else {
                next();
            }
        });
    };

    this.onUpdate = function(now) {
        var _self = this;
        if (this.scheduledUpdate && !now)
            return;
        this.scheduledUpdate = setTimeout(function() {
            var startTime = new Date().getTime();
            asyncForEach(_self.handlers, function(handler, next) {
                if (_self.isHandlerMatch(handler))
                    handler.onUpdate(_self.doc, next);
                else
                    next();
            }, function() {
                _self.analyze(function() {
                    _self.scheduledUpdate = null;
                    if (_self.postponedCursorMove) {
                        _self.onCursorMove(_self.postponedCursorMove);
                        _self.postponedCursorMove = null;
                    }
                    _self.lastUpdateTime = DEBUG ? 0 : new Date().getTime() - startTime;
                    clearTimeout(_self.scheduledUpdateFail);
                });
            });
        }, UPDATE_TIMEOUT_MIN + Math.min(this.lastUpdateTime, UPDATE_TIMEOUT_MAX));
        if (!DEBUG) {
            clearTimeout(this.scheduledUpdateFail);
            this.scheduledUpdateFail = setTimeout(function() {
                _self.scheduledUpdate = null;
                console.log("Warning: worker analysis taking too long, rescheduling");
            }, UPDATE_TIMEOUT_MAX + this.lastUpdateTime);
        }
    };
    
    this.$documentToString = function(document) {
        if (!document)
            return "";
        if (Array.isArray(document))
            return document.join("\n");
        if (typeof document == "string")
            return document;
        
        // Convert ArrayBuffer
        var array = [];
        for (var i = 0; i < document.byteLength; i++) {
            array.push(document[i]);
        }
        return array.join("\n");
    };

    this.switchFile = function(path, immediateWindow, language, document, pos, workspaceDir) {
        var _self = this;
        var oldPath = this.$path;
        var code = this.$documentToString(document);
        linereport.workspaceDir =
            this.$workspaceDir = workspaceDir === "" ? "/" : workspaceDir;
        linereport.path =
            this.$path = path;
        this.$language = language;
        this.immediateWindow = immediateWindow;
        this.lastCurrentNode = null;
        this.lastCurrentPos = null;
        this.cachedAsts = null;
        this.setValue(code);
        this.lastUpdateTime = 0;
        asyncForEach(this.handlers, function(handler, next) {
            _self.$initHandler(handler, oldPath, false, next);
        }, function() {
            _self.onUpdate(true);
        });
    };

    this.$initHandler = function(handler, oldPath, onDocumentOpen, callback) {
        function waitForPath() {
            if (!_self.$path)
                return setTimeout(waitForPath, 500);
            
            if (handler.$isInited)
                return callback();
            
            _self.$initHandler(handler, oldPath, onDocumentOpen, callback);
        }
        var _self = this;
        if (!this.$path) {
            // If we don't have a path, we need to wait
            // which is bad since we're already in the handlers list...
            if (!this.$warnedForPath)
                console.error("Warning: language handler registered without first calling switchFile");
            this.$warnedForPath = true;
            return waitForPath();
        }
        handler.path = this.$path;
        handler.language = this.$language;
        handler.workspaceDir = this.$workspaceDir;
        handler.doc = this.doc;
        handler.sender = this.sender;
        handler.completeUpdate = this.completeUpdate.bind(this);
        handler.immediateWindow = this.immediateWindow;
        handler.$getIdentifierRegex = this.getIdentifierRegex.bind(this);
        if (_self.$language) {
            if (handler.handlesLanguage(_self.$language) && handler.getIdentifierRegex())
                _self.sender.emit("setIdentifierRegex", { language: _self.$language, identifierRegex: handler.getIdentifierRegex() });
            if (handler.handlesLanguage(_self.$language) && handler.getCompletionRegex())
                _self.sender.emit("setCompletionRegex", { language: _self.$language, completionRegex: handler.getCompletionRegex() });
        }
        if (!handler.$isInited) {
            handler.$isInited = true;
            handler.init(function() {
                // Note: may not return for a while for asynchronous workers,
                //       don't use this for queueing other tasks
                handler.onDocumentOpen(_self.$path, _self.doc, oldPath, function() {});
                handler.$isInitCompleted = true;
                callback();
            });
        }
        else if (onDocumentOpen) {
            // Note: may not return for a while for asynchronous workers,
            //       don't use this for queueing other tasks
            handler.onDocumentOpen(_self.$path, _self.doc, oldPath, function() {});
            callback();
        }
        else {
            callback();
        }
    };

    this.documentOpen = function(path, immediateWindow, language, document) {
        this.$openDocuments["_" + path] = path;
        var _self = this;
        var code = this.$documentToString(document);
        var doc = {getValue: function() {return code;} };
        asyncForEach(this.handlers, function(handler, next) {
            handler.onDocumentOpen(path, doc, _self.path, next);
        });
    };
    
    this.documentClose = function(event) {
        var path = event.data;
        delete this.$openDocuments["_" + path];
        asyncForEach(this.handlers, function(handler, next) {
            handler.onDocumentClose(path, next);
        });
    };

    // For code completion
    function removeDuplicateMatches(matches) {
        // First sort
        matches.sort(function(a, b) {
            if (a.name < b.name)
                return 1;
            else if (a.name > b.name)
                return -1;
            else
                return 0;
        });
        for (var i = 0; i < matches.length - 1; i++) {
            var a = matches[i];
            var b = matches[i + 1];
            if (a.name === b.name || (a.id || a.name) === (b.id || b.name)) {
                // Duplicate!
                if (a.priority < b.priority)
                    matches.splice(i, 1);
                else if (a.priority > b.priority)
                    matches.splice(i+1, 1);
                else if (a.score < b.score)
                    matches.splice(i, 1);
                else if (a.score > b.score)
                    matches.splice(i+1, 1);
                else
                    matches.splice(i, 1);
                i--;
            }
        }
    }

    this.complete = function(event) {
        var _self = this;
        var data = event.data;
        var pos = data.pos;
        
        _self.waitForCompletionSync(event, function() {
            var part = syntaxDetector.getContextSyntaxPart(_self.doc, pos, _self.$language);
            var partPos = syntaxDetector.posToRegion(part.region, pos);
            var language = part.language;
            _self.parse(part, function(ast) {
                _self.findNode(ast, pos, function(node) {
                    var currentNode = node;
                    var matches = [];
    
                    asyncForEach(_self.handlers, function(handler, next) {
                        if (_self.isHandlerMatch(handler, part)) {
                            handler.staticPrefix = data.staticPrefix;
                            handler.language = language;
                            handler.workspaceDir = _self.$workspaceDir;
                            handler.path = _self.$path;
                            handler.complete(part, ast, partPos, currentNode, function(completions) {
                                if (completions && completions.length)
                                    matches = matches.concat(completions);
                                next();
                            });
                        }
                        else {
                            next();
                        }
                    }, function() {
                        removeDuplicateMatches(matches);
                        // Sort by priority, score
                        matches.sort(function(a, b) {
                            if (a.priority < b.priority)
                                return 1;
                            else if (a.priority > b.priority)
                                return -1;
                            else if (a.score < b.score)
                                return 1;
                            else if (a.score > b.score)
                                return -1;
                            else if (a.id && a.id === b.id) {
                                if (a.isFunction)
                                    return -1;
                                else if (b.isFunction)
                                    return 1;
                            }
                            if (a.name < b.name)
                                return -1;
                            else if (a.name > b.name)
                                return 1;
                            else
                                return 0;
                        });
                        _self.sender.emit("complete", {
                            pos: pos,
                            matches: matches,
                            isUpdate: event.data.isUpdate,
                            line: _self.doc.getLine(pos.row),
                            path: _self.$path,
                            forceBox: event.data.forceBox,
                            deleteSuffix: event.data.deleteSuffix
                        });
                    });
                });
            });
        });
    };
    
    /**
     * Check if the worker-side copy of the document is still up to date.
     * If needed, wait a little while for any pending change events
     * if needed (these should normally come in just before the complete event)
     */
    this.waitForCompletionSync = function(event, runCompletion) {
        var _self = this;
        var data = event.data;
        var pos = data.pos;
        var line = _self.doc.getLine(pos.row);
        this.waitForCompletionSyncThread = this.waitForCompletionSyncThread || 0;
        var threadId = ++this.waitForCompletionSyncThread;
        var regex = this.getIdentifierRegex(pos);
        if (!completeUtil.canCompleteForChangedLine(line, data.line, pos, pos, regex)) {
            setTimeout(function() {
                if (threadId !== _self.waitForCompletionSyncThread)
                    return;
                line = _self.doc.getLine(pos.row);
                if (!completeUtil.canCompleteForChangedLine(line, data.line, pos, pos, regex)) {
                    setTimeout(function() {
                        if (threadId !== _self.waitForCompletionSyncThread)
                            return;
                        if (!completeUtil.canCompleteForChangedLine(line, data.line, pos, pos, regex)) {
                            if (!line) { // sanity check
                                console.log("worker: seeing an empty line in my copy of the document, won't complete");
                            }
                            return; // ugh give up already
                        }
                        runCompletion();
                    }, 20);
                }
                runCompletion();
            }, 5);
            return;
        }
        runCompletion();
    };
    
    /**
     * Retrigger completion if the popup is still open and new
     * information is now available.
     */
    this.completeUpdate = function(pos, line) {
        assert(line !== undefined);
        if (!isInWebWorker) { // Avoid making the stack too deep in ?noworker=1 mode
            var _self = this;
            setTimeout(function onCompleteUpdate() {
                _self.complete({data: {pos: pos, line: line, staticPrefix: _self.staticPrefix, isUpdate: true}});
            }, 0);
        }
        else {
            this.complete({data: {pos: pos, line: line, staticPrefix: this.staticPrefix, isUpdate: true}});
        }
    };

}).call(LanguageWorker.prototype);

});
