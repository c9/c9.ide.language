/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "plugin", "c9", "settings", "ace", "tabs", "preferences", "browsersupport"
    ];
    main.provides = ["language"];
    return main;

    function main(options, imports, register) {
        var c9        = imports.c9;
        var Plugin    = imports.plugin;
        var settings  = imports.settings;
        var aceHandle = imports.ace;
        var tabs      = imports.tabs;
        var prefs     = imports.preferences;
        var browsers  = imports.browsersupport;
        var BIG_FILE_LINES = 5000;
        var BIG_FILE_DELAY = 500;
        var UI_WORKER_DELAY = 3000; // longer delay to wait for plugins to load with require()
        var INITIAL_DELAY = 2000;
        var delayedTransfer;
        
        var WorkerClient = require("ace/worker/worker_client").WorkerClient;
        var useUIWorker  = window.location && /[?&]noworker=1/.test(window.location.search)
            || (browsers.getIEVersion() && browsers.getIEVersion() < 10);
        
        var lang = require("ace/lib/lang");
        
        var isContinuousCompletionEnabledSetting;
        var initedPages;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        emit.setMaxListeners(25); // avoid warnings during initialization
        
        var worker;
        var createUIWorkerClient;
        
        var loaded = false;

        function load() {
            if (loaded) return false;
            loaded = true;

            if (!useUIWorker)
                return doLoad();

            // If we have require.js, just load the worker in the UI
            window["req"+"uire"](["plugins/c9.ide.language/worker"], function(worker) {
                if (worker) {
                    createUIWorkerClient = worker.createUIWorkerClient;
                    return doLoad();
                }

                // If we're packed with mini-require.js, load the script directly into the DOM
                var scriptElement  = document.createElement("script");
                scriptElement.onload = function() {
                    window["req"+"uire"](["plugins/c9.ide.language/worker"], function(worker) {
                        createUIWorkerClient = worker.createUIWorkerClient;
                        doLoad();
                    });
                };
                scriptElement.src = "worker-c9.ide.language.js";
                scriptElement.type = "text/javascript";
                document.getElementsByTagName("head")[0].appendChild(scriptElement);
            });
        }
        
        var onCursorChangeDeferred;
        function onCursorChangeDefer() {
            if (!onCursorChangeDeferred) {
                onCursorChangeDeferred = lang.delayedCall(onCursorChange);
            }
            onCursorChangeDeferred.delay(250);
        }
    
        function onCursorChange() {
            worker.emit("cursormove", {
                data: worker.$doc.selection.getCursor()
            });
        }
        function onChange(e) {
            worker.changeListener(e);
            //@todo marker.onChange(session, e);
        }
        function onChangeMode() {
            notifyWorker("switchFile", { page: worker.$doc.c9doc.page });
        }
        
        /**
         * Notify the worker that the document changed
         *
         * @param type  the event type, documentOpen or switchFile
         * @param e     the originating event, should have an e.page.path and e.page.editor.ace
         */
        function notifyWorker(type, e){
            if (!worker)
                return plugin.once("worker.init", notifyWorker.bind(null, type, e));
            
            var page    = e.page;
            var path    = page && page.path;
            var session = page && page.editor.ace && page.editor.ace.session;
            if (!session)
                return;
            
            if (session !== worker.$doc) {
                if (worker.$doc) {
                    worker.$doc.off("change", onChange);
                    worker.$doc.off("changeMode", onChangeMode);
                    worker.$doc.selection.off("changeCursor", onCursorChangeDefer);
                }
                
                worker.$doc = session;
                
                session.selection.on("changeCursor", onCursorChangeDefer);
                session.on("changeMode", onChangeMode);
                session.on("change", onChange);
            }
                
            var syntax = session.syntax;
            
            var value = e.value || session.doc.$lines || [];

            draw();

            clearTimeout(delayedTransfer);
            
            if (type === "switchFile" && value.length > BIG_FILE_LINES) {
                return delayedTransfer = setTimeout(notifyWorkerTransferData.bind(null, type, path, syntax, value), BIG_FILE_DELAY);
            }
            
            console.log("Sent to worker [" + type + "] " + path + " (" + value.length + ")"); // DEBUG

            notifyWorkerTransferData(type, path, syntax, value);
        }
        
        function notifyWorkerTransferData(type, path, syntax, value) {
            // background tabs=open document, foreground tab=switch to file
            // this is needed because with concorde changeSession event is fired when document is still empty
            worker.call(type, [
                path, syntax, value, null, 
                options.workspaceDir
            ]);
        }

        function doLoad() {
            // We have to wait until the paths for ace are set - a nice module system will fix this
            // ide.on("extload", function() {
            
            // Create main worker for language processing
            if (useUIWorker) {
                worker = createUIWorkerClient(["treehugger", "ext", "ace", "c9", "plugins"], "plugins/c9.ide.language/worker", "LanguageWorker");
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

            tabs.on("page.destroy", function(e){
                var path = e.page.path;
                if (path)
                    worker.emit("documentClose", {data: path});
            });
            
            // Hook all newly opened files
            tabs.on("open", function(e){
                if (e.page.editorType === "ace") {
                    notifyWorker("documentOpen", e);
                    if (!tabs.getTabs) // single-tab minimal UI
                        notifyWorker("switchFile", { page: e.page });
                }
            });
            
            // Switch to any active file
            tabs.on("focus.sync", function(e){
                if (e.page.editor.type !== "ace")
                    return;
                
                notifyWorker("switchFile", e);
            });
            
            emit("worker.init", {worker: worker});
            plugin.on("newListener", function(type, listener){
                if (type == "worker.init") listener({worker: worker});
            });

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
                    "General" : {
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
        aceHandle.on("create", function(e){
            var editor = e.editor;
            
            if (!initedPages && tabs.getTabs) { // not in single-tab minimal UI
                tabs.getTabs().forEach(function(tab){
                    tab.getPages().forEach(function(page){
                        if (page.editorType === "ace") {
                            setTimeout(function() {
                                if (page.value)
                                    return notifyWorker("documentOpen", { page: page });
                                var value = page.document.value;
                                if (value)
                                    return notifyWorker("documentOpen", { page: page, value: value });
                                page.document.once("value.set", function(e) {
                                    notifyWorker("documentOpen", { page: page, value: e.value });
                                });
                            }, useUIWorker ? UI_WORKER_DELAY : INITIAL_DELAY);
                        }
                    });
                });
                if (tabs.focussedPage && tabs.focussedPage.path && tabs.focussedPage.editor.ace)
                    notifyWorker("switchFile", { page: tabs.focussedPage });
                
                initedPages = true;
            }
            
            editor.on("draw", function(){
                // Set selection event
                
                // ide.on("liveinspect", function (e) {
                //     worker.emit("inspect", { data: { row: e.row, col: e.col } });
                // });
            }, editor);
            // TODO investigate if this was really needed, editor.ace is already destroyed when this is called
            // editor.on("unload", function h2(){
            //     editor.ace.selection.off("changeCursor", onCursorChangeDefer);
            // }, editor);
            editor.on("document.load", function(e){
                var session = e.doc.getSession().session;
                
                updateSettings(e); //@todo
                session.once("changeMode", function() {
                    if (tabs.focussedPage === e.doc.page)
                        notifyWorker("switchFile", { page: e.doc.page });
                });

            });
            editor.on("document.unload", function(e){
            });
        });
        
        function draw(){
            emit("draw");
            draw = function(){};
        }
        
        function updateSettings(e) {
            if (!worker)
                return plugin.once("worker.init", updateSettings.bind(null, e));
            
            ["jshint", "instanceHighlight", "unusedFunctionArgs", "undeclaredVars"]
              .forEach(function(s){
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
                settings.getBool("user/language/@continuousCompletion");
            if (tabs.focussedPage)
                notifyWorker("switchFile", { page: tabs.focussedPage });
        }
        
        /***** Methods *****/
        
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
            if (worker)
                return worker.call("register", [modulePath, contents]);
                
            plugin.once("worker.init", function(e) {
                worker.on("registered", function reply(e) {
                    if (e.data.path !== modulePath)
                        return;
                    worker.removeEventListener(reply);
                    callback && callback(e.data.err);
                });
                worker.call("register", [modulePath, contents]);
            });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            // loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Language foundation for Cloud9 
         * @event afterfilesave Fires after a file is saved
         *   object:
         *     node     {XMLNode} description
         *     oldpath  {String} description
         **/
        plugin.freezePublicAPI({
            /**
             * 
             */
            isContinuousCompletionEnabled : isContinuousCompletionEnabled,
            
            /**
             * 
             */
            setContinuousCompletionEnabled : setContinuousCompletionEnabled,
            
            /**
             * Registers a new language handler.
             * @param modulePath  the require path of the handler
             * @param contents    (optionally) the contents of the handler script
             * @param callback    An optional callback called when the handler is initialized
             */
            registerLanguageHandler : registerLanguageHandler,
            
            /**
             * 
             */
            isInferAvailable : isInferAvailable
        });
        
        register(null, {
            language: plugin
        });
    }
});
 
    
/* Move to appropriate plugins
        marker.addMarkers({data:[]}, this.editor);
    },

    destroy: function () {
        // Language features
        marker.destroy();
        complete.destroy();
        refactor.destroy();
        this.$destroy();
*/
