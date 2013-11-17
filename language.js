/*
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "settings", "ace", "tabManager", "preferences",
        "browsersupport"
    ];
    main.provides = ["language"];
    return main;

    function main(options, imports, register) {
        var c9 = imports.c9;
        var Plugin = imports.Plugin;
        var settings = imports.settings;
        var aceHandle = imports.ace;
        var tabs = imports.tabManager;
        var prefs = imports.preferences;
        var browsers = imports.browsersupport;
        var BIG_FILE_LINES = 5000;
        var BIG_FILE_DELAY = 500;
        var UI_WORKER_DELAY = 3000; // longer delay to wait for plugins to load with require()
        var INITIAL_DELAY = 2000;
        var delayedTransfer;
        var lastWorkerMessage = {};
        
        var WorkerClient = require("ace/worker/worker_client").WorkerClient;
        var UIWorkerClient = require("ace/worker/worker_client").UIWorkerClient;
        var useUIWorker  = window.location && /[?&]noworker=1/.test(window.location.search)
            || (browsers.getIEVersion() && browsers.getIEVersion() < 10);

        var isContinuousCompletionEnabledSetting;
        var initedTabs;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        emit.setMaxListeners(50); // avoid warnings during initialization
        
        var worker;
        
        function onCursorChange() {
            emit("cursormove", { doc: worker.$doc, pos: worker.$doc.selection.getCursor() });
        }
        function onChange(e) {
            worker.changeListener(e);
            worker._signal("change", e);
        }
        function onChangeMode() {
            if (worker && worker.$doc && worker.$doc.c9doc && worker.$doc.c9doc.tab)
                notifyWorker("switchFile", { tab: worker.$doc.c9doc.tab });
        }
        
        /**
         * Notify the worker that the document changed
         *
         * @param type  the event type, documentOpen or switchFile
         * @param e     the originating event, should have an e.tab.path and e.tab.editor.ace
         */
        function notifyWorker(type, e) {
            if (!worker)
                return plugin.once("initWorker", notifyWorker.bind(null, type, e));
            
            var tab = e.tab;
            var path = tab && (tab.path || tab.name);
            var session = tab && tab.editor.ace && tab.editor.ace.session;
            if (!session)
                return;
            var immediateWindow = session.repl ? tab.name : null;
            
            if (session !== worker.$doc && type === "switchFile") {
                if (worker.$doc) {
                    worker.$doc.off("change", onChange);
                    worker.$doc.off("changeMode", onChangeMode);
                    worker.$doc.selection.off("changeCursor", onCursorChange);
                }
                
                worker.$doc = session;
                
                session.selection.on("changeCursor", onCursorChange);
                session.on("changeMode", onChangeMode);
                session.on("change", onChange);
            }
            
            // Avoid sending duplicate messages
            var last = lastWorkerMessage;
            if (last.type === type && last.path === path && last.immediateWindow === immediateWindow
                && last.syntax === syntax)
                return;
            lastWorkerMessage = {
                type: type,
                path: path,
                immediateWindow: immediateWindow,
                syntax: syntax
            };
                
            var syntax = session.syntax;
            if (session.$modeId)
                syntax = /[^\/]*$/.exec(session.$modeId)[0] || syntax;
            session.syntax = syntax;
            
            var value = e.value || session.doc.$lines || [];

            draw();

            clearTimeout(delayedTransfer);
            
            if (type === "switchFile" && value.length > BIG_FILE_LINES) {
                delayedTransfer = setTimeout(notifyWorkerTransferData.bind(null, type, path, immediateWindow, syntax, value), BIG_FILE_DELAY);
                return delayedTransfer;
            }
            
            console.log("[language] Sent to worker (" + type + "): " + path + " length: " + value.length);

            notifyWorkerTransferData(type, path, immediateWindow, syntax, value);
        }
        
        function notifyWorkerTransferData(type, path, immediateWindow, syntax, value) {
            if (options.workspaceDir === undefined)
                console.error("[language] options.workspaceDir is undefined!");
            // background tabs=open document, foreground tab=switch to file
            // this is needed because with concorde changeSession event is fired when document is still empty
            worker.call(type, [
                path, immediateWindow, syntax, value, null, 
                options.workspaceDir
            ]);
        }
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            // Create main worker for language processing
            if (useUIWorker) {
                worker = new UIWorkerClient(["treehugger", "ext", "ace", "c9", "plugins"], "plugins/c9.ide.language/worker", "LanguageWorker");
            }
            else  {
                try {
                    worker = new WorkerClient(["treehugger", "ext", "ace", "c9", "plugins"], "plugins/c9.ide.language/worker", "LanguageWorker");
                } catch (e) {
                    if (e.code === 18 && window.location && window.location.origin === "file://")
                        throw new Error("Cannot load worker from file:// protocol, please host a server on localhost instead or use ?noworker=1 to use a worker in the UI thread (can cause slowdowns)");
                    throw e;
                }
            }

            tabs.on("tabDestroy", function(e) {
                var path = e.tab.path;
                if (path)
                    worker.emit("documentClose", {data: path});
            });
            
            // Hook all newly opened files
            tabs.on("open", function(e) {
                if (isEditorSupported(e.tab)) {
                    notifyWorker("documentOpen", e);
                    if (!tabs.getPanes) // single-pane minimal UI
                        notifyWorker("switchFile", { tab: e.tab });
                }
            });
            
            // Switch to any active file
            tabs.on("focusSync", function(e) {
                if (isEditorSupported(e.tab))               
                    notifyWorker("switchFile", e);
            });
            
            emit("initWorker", { worker: worker }, true);

            settings.on("read", function() {
                settings.setDefaults("user/language", [
                    ["jshint", "true"], //@todo move to appropriate plugin
                    ["instanceHighlight", "true"],
                    ["undeclaredVars", "true"],
                    ["unusedFunctionArgs", "false"],
                    ["continuousCompletion", "true"]
                ]);
                settings.setDefaults("project/language", [
                    ["warnLevel", "info"]
                ]);
                updateSettings();
            });
            
            settings.on("user/language", updateSettings);
            settings.on("project/language", updateSettings);
    
            // Preferences
            prefs.add({
                "Project" : {
                    "Markers" : {
                        position : 200,
                        "Warning Level" : {
                           type     : "dropdown",
                           path     : "project/language/@warnLevel",
                           items    : [
                               { caption : "Error", value : "error" },
                               { caption : "Warning", value : "warning" },
                               { caption : "Info", value : "info" }
                           ],
                           position : 5000
                        }
                    }
                }
            }, plugin);
            
            prefs.add({
                "Language" : {
                    position : 500,
                    "Auto Complete" : {
                        position : 100,
                        "Complete As You Type" : {
                            type     : "checkbox",
                            path     : "user/language/@continuousCompletion",
                            position : 4000
                        }
                    },
                    "Markers" : {
                        position : 200,
                        "Enable Hints and Warnings" : {
                            type     : "checkbox",
                            path     : "user/language/@jshint",
                            position : 1000
                        },
                        "Highlight Variable Instances" : {
                            type     : "checkbox",
                            path     : "user/language/@instanceHighlight",
                            position : 2000
                        },
                        "Mark Undeclared Variables" : {
                            type     : "checkbox",
                            path     : "user/language/@undeclaredVars",
                            position : 3000
                        },
                        "Mark Unused Function Arguments" : {
                            type     : "checkbox",
                            path     : "user/language/@unusedFunctionArgs",
                            position : 4000
                        }
                    }
                }
            }, plugin);
        }
        
        // Initialize an Ace editor
        aceHandle.on("create", function(e) {
            var editor = e.editor;
            
            if (!initedTabs && tabs.getPanes) { // not in single-pane minimal UI
                tabs.getTabs().forEach(function(tab) {
                    if (isEditorSupported(tab)) {
                        setTimeout(function() {
                            if (tab.value)
                                return notifyWorker("documentOpen", { tab: tab, value: tab.value });
                            var value = tab.document.value;
                            if (value)
                                return notifyWorker("documentOpen", { tab: tab, value: value });
                            tab.document.once("valueSet", function(e) {
                                notifyWorker("documentOpen", { tab: tab, value: e.value });
                            });
                        }, useUIWorker ? UI_WORKER_DELAY : INITIAL_DELAY);
                    }
                });
                if (tabs.focussedTab && tabs.focussedTab.path && tabs.focussedTab.editor.ace)
                    notifyWorker("switchFile", { tab: tabs.focussedTab });
                
                initedTabs = true;
            }
            
            // TODO investigate if this was really needed, editor.ace is already destroyed when this is called
            // editor.on("unload", function h2() {
            //     editor.ace.selection.off("changeCursor", onCursorChangeDefer);
            // }, editor);
            editor.on("documentLoad", function(e) {
                var session = e.doc.getSession().session;
                
                updateSettings(e); //@todo
                session.once("changeMode", function() {
                    if (tabs.focussedTab === e.doc.tab)
                        notifyWorker("switchFile", { tab: e.doc.tab });
                });

            });
            editor.on("documentUnload", function(e) {
            });
        });
        
        function draw() {
            emit("draw");
            draw = function() {};
        }
        
        function getWorker(callback) {
            if (worker)
                return setTimeout(callback.bind(null, null, worker)); // always async
            plugin.once("initWorker", function() {
                callback(null, worker);
            });
        }
        
        function updateSettings() {
            if (!worker)
                return plugin.once("initWorker", updateSettings);
            
            ["jshint", "instanceHighlight", "unusedFunctionArgs", "undeclaredVars"]
              .forEach(function(s) {
                worker.call(
                    (settings.getBool("user/language/@" + s) ? "enable" : "disable")
                    + "Feature", [s]);
            });
                
            worker.call("setWarningLevel", 
                [settings.get("project/language/@warnLevel")]);
                
            // var cursorPos = editor.getCursorPosition();
            // cursorPos.force = true;
            // worker.emit("cursormove", {data: cursorPos});
            
            isContinuousCompletionEnabledSetting = 
                settings.get("user/language/@continuousCompletion") != "false";
            if (tabs.focussedTab)
                notifyWorker("switchFile", { tab: tabs.focussedTab });
        }
        
        /***** Methods *****/
        
        function isEditorSupported(tab) {
            return ["ace", "immediate"].indexOf(tab.editor ? tab.editor.type : tab.editorType) !== -1;
        }
        
        function isWorkerEnabled() {
            return !useUIWorker;
        }
    
        function isInferAvailable() {
            return c9.hosted; // || !!req uire("core/ext").extLut["ext/jsinfer/jsinfer"];
        }
        
        function isContinuousCompletionEnabled() {
            return isContinuousCompletionEnabledSetting;
        }
    
        function setContinuousCompletionEnabled(value) {
            isContinuousCompletionEnabledSetting = value;
        }
    
        function registerLanguageHandler(modulePath, contents, callback) {
            if (!callback && typeof contents === "function") {
                callback = contents;
                contents = null;
            }
            
            getWorker(function(err, worker) {
                worker.on("registered", function reply(e) {
                    if (e.data.path !== modulePath)
                        return;
                    worker.removeEventListener(reply);
                    callback && callback(e.data.err, worker);
                });
                worker.call("register", [modulePath, contents]);
            });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("enable", function() {
            
        });
        plugin.on("disable", function() {
            
        });
        plugin.on("unload", function() {
            // loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * The language foundation for Cloud9, controlling language
         * handlers that implement features such as content completion
         * for various languages.
         * 
         * Language handlers are executed inside a web worker.
         * They can be registered using the {@link #registerLanguageHandler}
         * function, and should be based on the {@link language.base_handler}
         * base class.
         * 
         * @singleton
         **/
        plugin.freezePublicAPI({
            /**
             * @ignore
             */
            isEditorSupported : isEditorSupported,

            /**
             * Returns true if the "continuous completion" IDE setting is enabled
             * @ignore
             * @return {Boolean}
             */
            isContinuousCompletionEnabled : isContinuousCompletionEnabled,
            
            /**
             * Sets whether the "continuous completion" IDE setting is enabled
             * @ignore
             * @param {Boolean} value
             */
            setContinuousCompletionEnabled : setContinuousCompletionEnabled,
            
            /**
             * Returns whether type inference for JavaScript is available.
             * @ignore
             */
            isInferAvailable : isInferAvailable,
            
            /**
             * Registers a new language handler in the web worker.
             * Clients should specify a module path where the handler can be loaded.
             * Normally, it can be loaded in the web worker using a regular require(),
             * but if it is not available in the context of the web worker (perhaps
             * because it is hosted elsewhere), clients can also specify a string
             * source for the handler.
             * 
             * @param {String} modulePath      The require path of the handler
             * @param {String} [contents]      The contents of the handler script
             * @param {Function} [callback]    An optional callback called when the handler is initialized
             * @param {String} callback.err    Any error that occured when loading this handler
             * @param {Object} callback.worker The worker object (see {@link #getWorker})
             */
            registerLanguageHandler : registerLanguageHandler,
            
            /**
             * Gets the current worker, or waits for it to be ready and gets it.
             * 
             * @param {Function} callback                      The callback
             * @param {String} callback.err                    Any error
             * @param {Function} callback.result               Our result
             * @param {Function} callback.result.on            Event handler for worker events
             * @param {String} callback.result.on.event        Event name
             * @param {Function} callback.result.on.handler    Event handler function
             * @param {Object} callback.result.on.handler.data Event data
             * @param {Function} callback.result.emit          Event emit function for worker
             * @param {String} callback.result.on.event        Event name
             * @param {Object} callback.result.on.data         Event data
             */
            getWorker : getWorker
        });
        
        register(null, {
            language: plugin
        });
    }
});
