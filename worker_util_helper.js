/*
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "language", "proc", "fs", "tabManager", "save"
    ];
    main.provides = ["language.worker_util_helper"];
    return main;

    function main(options, imports, register) {
        var c9 = imports.c9;
        var Plugin = imports.Plugin;
        var plugin = new Plugin("Ajax.org", main.consumes);
        var language = imports.language;
        var proc = imports.proc;
        var fs = imports.fs;
        var tabs = imports.tabManager;
        var save = imports.save;
        var syntaxDetector = require("./syntax_detector");
        
        var loaded;
        function load() {
            if (loaded) return;
            loaded = true;
    
            language.getWorker(function(err, worker) {
                if (err)
                    return console.error(err);
                worker.on("execFile", function(e) {
                    ensureConnected(
                        proc.execFile.bind(proc, e.data.path, e.data.options),
                        function(err, stdout, stderr) {
                            worker.emit("execFileResult", { data: {
                                id: e.data.id,
                                err: err,
                                stdout: stdout,
                                stderr: stderr
                            }});
                        }
                    );
                });
                
                worker.on("readFile", function(e) {
                    readTabOrFile(e.data.path, {
                        encoding: e.data.encoding
                    }, function(err, value) {
                        worker.emit("readFileResult", { data: {
                            id: e.data.id,
                            err: err && JSON.stringify(err),
                            data: value
                        }});
                    });
                });
                
                worker.on("getTokens", function(e) {
                    var path = e.data.path;
                    var identifiers = e.data.identifiers;
                    var region = e.data.region;
                    
                    var tab = tabs.findTab(path);
                    if (!tab || !tab.editor || !tab.editor.ace)
                        return done("Tab is no longer open");
                    
                    var session = tab.editor.ace.getSession();
                    var results = [];
                    for (var i = 0, len = session.getLength(); i < len; i++) {
                        if (region && !(region.sl <= i && i <= region.el))
                            continue;
                        var offset = 0;
                        session.getTokens(i).forEach(function(t) {
                            var myOffset = offset;
                            offset += t.value.length;
                            if (identifiers && identifiers.indexOf(t.value) === -1)
                                return;
                            if (region && region.sl === i && myOffset < region.sc)
                                return;
                            if (region && region.el === i && myOffset > region.ec)
                                return;
                            var result = {
                                row: i,
                                column: myOffset
                            };
                            if (region)
                                result = syntaxDetector.posToRegion(region, result);
                            result.value = t.value;
                            results.push(result);
                        });
                    }
                    done(null, results);
                    
                    function done(err, results) {
                        worker.emit("getTokensResult", { data: {
                            id: e.data.id,
                            err: err,
                            results: results
                        }});
                    }
                });
            });
        }
        
        function ensureConnected(f, callback, timeout) {
            timeout = timeout || 200;
            if (!c9.NETWORK) {
                return c9.once("stateChange", function(e) {
                    setTimeout(
                        ensureConnected.bind(null, f, callback, timeout * 2),
                        timeout
                    );
                });
            }
            f(function(err) {
                if (err && err.code === "EDISCONNECT")
                    return ensureConnected(f, callback, timeout);
                callback.apply(null, arguments);
            });
        }
        
        function readTabOrFile(path, options, callback) {
            var allowUnsaved = options.allowUnsaved;
            delete options.allowUnsaved;
            
            var tab = tabs.findTab(path);
            if (tab) {
                if (options.unsaved) {
                    var unsavedValue = tab.value
                        || tab.document && tab.document.hasValue && tab.document.hasValue()
                           && tab.document.value;
                    if (unsavedValue)
                        return callback(null, unsavedValue);
                }
                else {
                    var saved = allowUnsaved || save.getSavingState(tab) === "saved";
                    var value = saved
                        ? tab.value || tab.document && tab.document.value
                        : tab.document.meta && typeof tab.document.meta.$savedValue === "string"
                          && tab.document.meta.$savedValue;
                    if (value)
                        return callback(null, value);
                }
                
            }
            
            if (!options.encoding)
                options.encoding = "utf8"; // TODO: get from c9?
            
            ensureConnected(
                fs.readFile.bind(fs, path, options),
                callback
            );
        }
        
        plugin.on("load", function() {
            load();
        });
        
        plugin.freezePublicAPI({
            readTabOrFile: readTabOrFile
        });
        
        register(null, {
            "language.worker_util_helper": plugin
        });
    }

});