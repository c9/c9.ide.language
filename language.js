/*
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "settings", "ace", "tabManager", "preferences",
        "browsersupport", "commands"
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
        var commands = imports.commands;
        var WorkerClient = require("ace/worker/worker_client").WorkerClient;
        var UIWorkerClient = require("ace/worker/worker_client").UIWorkerClient;

        var BIG_FILE_LINES = 5000;
        var BIG_FILE_DELAY = 500;
        var UI_WORKER_DELAY = 3000; // longer delay to wait for plugins to load with require()
        var INITIAL_DELAY = 2000;
        var UI_WORKER = window.location && /[?&]noworker=(\w+)|$/.exec(window.location.search)[1]
            || (browsers.getIEVersion() && browsers.getIEVersion() < 10) || options.useUIWorker;

        var delayedTransfer;
        var lastWorkerMessage = {};
        var isContinuousCompletionEnabledSetting;
        var initedTabs;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        emit.setMaxListeners(50); // avoid warnings during initialization
        
        var worker;
        
        function onCursorChange(e, sender, now) {
            var cursorPos = worker.$doc.selection.getCursor();
            var line = worker.$doc.getDocument().getLine(cursorPos.row);
            emit("cursormove", {
                doc: worker.$doc,
                pos: cursorPos,
                line: line,
                selection: worker.$doc.selection,
                now: now
            });
        }
        function onChange(e) {
            worker.changeListener(e);
            worker._signal("change", e);
        }
        function onChangeMode() {
            if (worker && worker.$doc && worker.$doc.c9doc && worker.$doc.c9doc.tab) {
                notifyWorker("switchFile", { tab: worker.$doc.c9doc.tab });
                worker._signal("changeMode");
            }
        }
        
        /**
         * Notify the worker that the document changed
         *
         * @param type  the event type, documentOpen or switchFile
         * @param e     the originating event, should have an e.tab.path and e.tab.document
         */
        function notifyWorker(type, e) {
            if (!worker)
                return plugin.once("initWorker", notifyWorker.bind(null, type, e));
            
            var tab = e.tab;
            var path = getTabPath(tab);
            var c9session = tab.document.getSession();
            var session = c9session && c9session.loaded && c9session.session;
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
            
            var syntax = session.syntax;
            if (!syntax && session.$modeId) {
                syntax = /[^\/]*$/.exec(session.$modeId)[0] || syntax;
                session.syntax = syntax;
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
            
            var value = e.value || session.doc.$lines || [];

            draw();

            clearTimeout(delayedTransfer);
            
            if (type === "switchFile" && value.length > BIG_FILE_LINES) {
                delayedTransfer = setTimeout(notifyWorkerTransferData.bind(null, type, path, immediateWindow, syntax, value), BIG_FILE_DELAY);
                return delayedTransfer;
            }

            notifyWorkerTransferData(type, path, immediateWindow, syntax, value);
        }
        
        function notifyWorkerTransferData(type, path, immediateWindow, syntax, value) {
            if (type === "switchFile" && getTabPath(tabs.focussedTab) !== path)
                return;
            console.log("[language] Sent to worker (" + type + "): " + path + " length: " + value.length);
            if (options.workspaceDir === undefined)
                console.error("[language] options.workspaceDir is undefined!");
            // background tabs=open document, foreground tab=switch to file
            if (type == "switchFile" && worker.deltaQueue) {
                value = worker.$doc.$lines; // in case we are called async
                worker.deltaQueue = null;
            }
            worker.call(type, [
                path, immediateWindow, syntax, value, null, 
                options.workspaceDir
            ]);
        }
        
        function getTabPath(tab) {
            return tab && (tab.path || tab.name);
        }
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            var id = "plugins/c9.ide.language/worker";
            if (options.workerPrefix)
                var path = options.workerPrefix + "/" + id + ".js";
            
            // Create main worker for language processing
            if (UI_WORKER) {
                worker = new UIWorkerClient(["treehugger", "ace", "c9", "plugins"], id, "LanguageWorker", path);
                if (UI_WORKER === "sync")
                    worker.setEmitSync(true);
            }
            else  {
                try {
                    worker = new WorkerClient(["treehugger", "ace", "c9", "plugins"], id, "LanguageWorker", path);
                } catch (e) {
                    if (e.code === 18 && window.location && window.location.origin === "file://")
                        throw new Error("Cannot load worker from file:// protocol, please host a server on localhost instead or use ?noworker=1 to use a worker in the UI thread (can cause slowdowns)");
                    throw e;
                }
            }
            
            worker.call("setStaticPrefix", [options.staticPrefix || c9.staticUrl || "/static"]);

            aceHandle.on("create", function(e) {
                e.editor.on("createAce", function (ace) {
                    emit("attachToEditor", ace);
                });
            });
            
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
            
            emit.sticky("initWorker", { worker: worker });

            settings.on("read", function() {
                settings.setDefaults("user/language", [
                    ["jshint", "true"], //@todo move to appropriate plugin
                    ["instanceHighlight", "true"],
                    ["undeclaredVars", "true"],
                    ["unusedFunctionArgs", "false"],
                    ["continuousCompletion", "true"],
                    ["enterCompletion", "false"]
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
                        position: 200,
                        "Warning Level" : {
                           type: "dropdown",
                           path: "project/language/@warnLevel",
                           items: [
                               { caption : "Error", value : "error" },
                               { caption : "Warning", value : "warning" },
                               { caption : "Info", value : "info" }
                           ],
                           position: 5000
                        }
                    }
                }
            }, plugin);
            
            prefs.add({
                "Language" : {
                    position: 500,
                    "Auto Complete" : {
                        position: 100,
                        "Complete As You Type" : {
                            type: "checkbox",
                            path: "user/language/@continuousCompletion",
                            position: 4000
                        },
                        "Complete On Enter" : {
                            type: "checkbox",
                            path: "user/language/@enterCompletion",
                            position: 5000
                        },
                    },
                    "Markers" : {
                        position: 200,
                        "Enable Hints and Warnings" : {
                            type: "checkbox",
                            path: "user/language/@jshint",
                            position: 1000
                        },
                        "Highlight Variable Instances" : {
                            type: "checkbox",
                            path: "user/language/@instanceHighlight",
                            position: 2000
                        },
                        "Mark Undeclared Variables" : {
                            type: "checkbox",
                            path: "user/language/@undeclaredVars",
                            position: 3000
                        },
                        "Mark Unused Function Arguments" : {
                            type: "checkbox",
                            path: "user/language/@unusedFunctionArgs",
                            position: 4000
                        }
                    }
                }
            }, plugin);
            
            // commands
            commands.addCommand({
                name: "expandSnippet",
                bindKey: "Tab",
                exec: function(editor) {
                    return editor.ace.expandSnippet();
                },
                isAvailable: function(editor) {
                    return editor.ace.expandSnippet({dryRun: true});
                },
            }, plugin);
        }
        
        // Initialize an Ace editor
        aceHandle.on("create", function(e) {
            var editor = e.editor;
            
            if (!initedTabs && tabs.getPanes) { // not in single-pane minimal UI
                tabs.on("ready", function() {
                    if (initedTabs)
                        return;
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
                            }, UI_WORKER ? UI_WORKER_DELAY : INITIAL_DELAY);
                        }
                    });
                    if (tabs.focussedTab && tabs.focussedTab.path && tabs.focussedTab.editor.ace)
                        notifyWorker("switchFile", { tab: tabs.focussedTab });

                    initedTabs = true;
                });
            }
            
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
                settings.get("user/language/@continuousCompletion");
                
            if (tabs.focussedTab)
                notifyWorker("switchFile", { tab: tabs.focussedTab });
        }
        
        /***** Methods *****/
        
        function isEditorSupported(tab) {
            return ["ace", "immediate"].indexOf(tab.editor ? tab.editor.type : tab.editorType) !== -1;
        }
        
        function isWorkerEnabled() {
            return !UI_WORKER;
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
         * base class. For examples, see {@link language.base_handler}.
         * 
         * Here's an example of a language worker plugin that
         * loads one language worker:
         *
         *     define(function(require, exports, module) {
         *         main.consumes = ["language"];
         *         main.provides = [];
         *         return main;
         *     
         *         function main(options, imports, register) {
         *             var language = imports.language;
         *     
         *             language.registerLanguageHandler('plugins/my.plugin/foo_handler');
         *             
         *             register(null, {});
         *         }
         *     });
         *
         * The plugin to load a langauge worker tends to be quite small, like
         * the above. The actual work is done in the handler itself, here
         * called plugins/my.plugin/foo_handler. This plugin lives inside
         * the worker and must implement the {@link language.base_handler}
         * interface.
         * 
         * Here's an example of a language handler implementing base_handler:
         * 
         *     define(function(require, exports, module) {
         *         var baseHandler = require('plugins/c9.ide.language/base_handler');
         *         var handler = module.exports = Object.create(baseHandler);
         *      
         *         handler.handlesLanguage = function(language) {
         *             return language === "javascript";
         *         };
         *      
         *         handler.analyze = function(value, ast, callback) {
         *             if (!ast)
         *                 return;
         *             callback([{
         *                  pos: { sl: 0, el: 0, sc: 0, ec: 0 },
         *                  type: 'info',
         *                  level: 'info',
         *                  message: 'Hey there! I'm an info marker'
         *            }]);
         *         };
         *     });
         * 
         * Note how the above handler doesn't use the Architect plugin
         * infrastructure, and can only acesss other plugins that exist
         * inside the web worker, such as {@link language.worker_util}
         * or {@link language.complete_util}.
         * 
         * @singleton
         **/
        plugin.freezePublicAPI({
            /**
             * @ignore
             */
            isEditorSupported: isEditorSupported,

            /**
             * Returns true if the "continuous completion" IDE setting is enabled
             * @ignore
             * @return {Boolean}
             */
            isContinuousCompletionEnabled: isContinuousCompletionEnabled,
            
            /**
             * Sets whether the "continuous completion" IDE setting is enabled
             * @ignore
             * @param {Boolean} value
             */
            setContinuousCompletionEnabled: setContinuousCompletionEnabled,
            
            /**
             * Returns whether type inference for JavaScript is available.
             * @ignore
             */
            isInferAvailable: isInferAvailable,
            
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
            registerLanguageHandler: registerLanguageHandler,
            
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
            getWorker: getWorker,
            
            /** @ignore */
            onCursorChange: onCursorChange,

            _events: []
        });
        
        register(null, {
            language: plugin
        });
    }
});
