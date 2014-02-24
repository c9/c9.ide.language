/*global describe it before after beforeEach*/

"use client";

require(["lib/architect/architect", "lib/chai/chai", "plugins/c9.ide.language/complete_util"], function (architect, chai, util, complete) {
    var expect = chai.expect;
    
    util.setStaticPrefix("/static");
    
    expect.setupArchitectTest([
        {
            packagePath  : "plugins/c9.core/c9",
            workspaceId  : "ubuntu/ip-10-35-77-180",
            startdate    : new Date(),
            debug        : true,
            hosted       : true,
            local        : false,
            davPrefix    : "/",
            staticPrefix : "/static"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        {
            packagePath: "plugins/c9.core/settings",
            testing: true
        },
        "plugins/c9.core/api.js",
        {
            packagePath  : "plugins/c9.ide.ui/ui",
            staticPrefix : "plugins/c9.ide.ui"
        },
        "plugins/c9.ide.editors/document",
        "plugins/c9.ide.editors/undomanager",
        {
            packagePath: "plugins/c9.ide.editors/editors",
            defaultEditor: "ace"
        },
        "plugins/c9.ide.editors/editor",
        "plugins/c9.ide.editors/tabmanager",
        "plugins/c9.ide.ui/focus",
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        {
            packagePath : "plugins/c9.ide.ace/ace",
            staticPrefix : "plugins/c9.ide.layout.classic"
        },
        {
            packagePath: "plugins/c9.ide.language/language",
            workspaceDir : "/"
        },
        "plugins/c9.ide.language/keyhandler",
        "plugins/c9.ide.language/complete",
        "plugins/c9.ide.language/tooltip",
        "plugins/c9.ide.language/marker",
        "plugins/c9.ide.language.generic/generic",
        "plugins/c9.ide.language.javascript/javascript",
        "plugins/c9.ide.language.javascript.infer/jsinfer",
        "plugins/c9.ide.keys/commands",
        "plugins/c9.fs/proc",
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        "plugins/c9.fs/fs",
        "plugins/c9.ide.browsersupport/browsersupport",
        "plugins/c9.ide.ui/menus",
        {
            packagePath: "plugins/c9.ide.immediate/immediate",
            staticPrefix : "plugins/c9.ide.layout.classic"
        },
        "plugins/c9.ide.language.javascript.immediate/immediate",
        "plugins/c9.ide.immediate/evaluator",
        "plugins/c9.ide.immediate/evaluators/browserjs",
        "plugins/c9.ide.console/console",
        "plugins/c9.ide.ace.statusbar/statusbar",
        "plugins/c9.ide.ace.gotoline/gotoline",
        
        // Mock plugins
        {
            consumes : ["apf", "ui", "Plugin"],
            provides : [
                "commands", "menus", "layout", "watcher", 
                "save", "preferences", "anims", "clipboard", "auth.bootstrap",
                "info", "dialog.error", "panels", "tree", "dialog.question",
                "dialog.alert"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : [
                "tabManager",
                "ace",
                "Document",
                "language.keyhandler",
                "language.complete",
                "language"
            ],
            provides : [],
            setup    : main
        }
    ], architect);
    
    function main(options, imports, register) {
        var tabs = imports.tabManager;
        var ace = imports.ace;
        var Document = imports.Document;
        var language = imports.language;
        var complete = imports["language.complete"];
        
        util.setStaticPrefix("/static");
        complete.$setShowDocDelay(50);
        
        function getTabHtml(tab) {
            return tab.pane.aml.getPage("editor::" + tab.editorType).$ext;
        }
        
        function afterCompleteOpen(callback) {
            setTimeout(function() {
                var el = document.getElementsByClassName("ace_autocomplete")[0];
                if (!el || el.style.display === "none")
                    return setTimeout(function() {
                         afterCompleteOpen(callback);
                    }, 1000);
                setTimeout(function() {
                    callback(el);
                }, 50);
            }, 50);
        }
        
        function afterCompleteDocOpen(callback) {
            setTimeout(function() {
                var el = document.getElementsByClassName("code_complete_doc_text")[0];
                if (!el || el.style.display === "none")
                    return afterCompleteDocOpen(callback);
                setTimeout(function() {
                    callback(el);
                }, 50);
            }, 50);
        }
        
        function isCompleterOpen() {
            return document.getElementsByClassName("ace_autocomplete")[0].style.display === "none";
        }
        
        expect.html.setConstructor(function(tab) {
            if (typeof tab == "object")
                return getTabHtml(tab);
        });
        
        describe('ace', function() {
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                
                window.bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                window.bar.$ext.style.position = "fixed";
                window.bar.$ext.style.left = "20px";
                window.bar.$ext.style.right = "20px";
                window.bar.$ext.style.bottom = "20px";
                window.bar.$ext.style.height = "33%";
      
                document.body.style.marginBottom = "33%";
                
                tabs.on("ready", function(){
                    tabs.getPanes()[0].focus();
                    done();
                });
            });
            
            describe("analysis", function(){
                this.timeout(10000);
                var jsTab;
                var jsSession;
                
                // Setup
                beforeEach(function(done) {
                    tabs.getTabs().forEach(function(tab) {
                        tab.close(true);
                    });
                    // tab.close() isn't quite synchronous, wait for it :(
                    setTimeout(function() {
                        complete.closeCompletionBox();
                        tabs.openFile("language.js", function(err, tab) {
                            jsTab = tab;
                            jsSession = jsTab.document.getSession().session;
                            expect(jsSession).to.not.equal(null);
                            if (!complete.getCompletionRegex("javascript")) {
                                return language.getWorker(function(err, worker) {
                                    worker.on("setCompletionRegex", function(e) {
                                        if (e.data.language === "javascript")
                                            setTimeout(done);
                                    });
                                });
                            }
                            setTimeout(done);
                        });
                    }, 500);
                });
                
                // TODO: make sure this works in the ci server
                it.skip("has three markers initially", function(done) {
                    jsSession.on("changeAnnotation", function onAnnos() {
                        if (!jsSession.getAnnotations().length)
                            return;
                        if (jsSession.getAnnotations().length !== 3)
                            return; // for this test, it's fine as long as it's eventually 3
                        jsSession.off("changeAnnotation", onAnnos);
                        expect(jsSession.getAnnotations()).to.have.length(3);
                        done();
                    });
                });
                
                it('shows a word completer popup on keypress', function(done) {
                    jsSession.setValue("conny con");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("n");
                    afterCompleteOpen(function(el) {
                        expect.html(el).text(/conny/);
                        done();
                    });
                });
                
                it('shows an inference completer popup on keypress', function(done) {
                    jsSession.setValue("console.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompleteOpen(function(el) {
                        expect.html(el).text(/log\(/);
                        done();
                    });
                });
                
                it('always does dot completion', function(done) {
                    language.setContinuousCompletionEnabled(false);
                    jsSession.setValue("console");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput(".");
                    afterCompleteOpen(function(el) {
                        expect.html(el).text(/log\(/);
                        language.setContinuousCompletionEnabled(false);
                        done();
                    });
                });
                
                it('shows a documentation popup in completion', function(done) {
                    jsSession.setValue("console.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompleteDocOpen(function(el) {
                        expect.html(el).text(/stdout/);
                        done();
                    });
                });
                
                it('shows a word completer in an immediate tab', function(done) {
                    tabs.open(
                        {
                            active     : true,
                            editorType : "immediate"
                        },
                        function(err, tab) {
                            // We get a tab, but it's not done yet, so we wait
                            setTimeout(function() {
                                expect(!isCompleterOpen());
                                tab.editor.ace.onTextInput("conny con");
                                expect(!isCompleterOpen());
                                tab.editor.ace.onTextInput("n");
                                afterCompleteOpen(function(el) {
                                    expect.html(el).text(/conny/);
                                    done();
                                });
                            });
                        }
                    );
                });
                
                it('shows an immediate completer in an immediate tab', function(done) {
                    tabs.open(
                        {
                            active     : true,
                            editorType : "immediate"
                        },
                        function(err, tab) {
                            // We get a tab, but it's not done yet, so we wait
                            setTimeout(function() {
                                tab.editor.ace.onTextInput("window.a");
                                tab.editor.ace.onTextInput("p");
                                afterCompleteOpen(function(el) {
                                    expect.html(el).text(/applicationCache/);
                                    done();
                                });
                            });
                        }
                    );
                });
            });
        });
        
        onload && onload();
    }
});
