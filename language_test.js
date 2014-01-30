/*global describe it before after  =*/

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
        require("plugins/c9.ide.language/complete_util").setStaticPrefix("/static");
        var tabs = imports.tabManager;
        var ace = imports.ace;
        var Document = imports.Document;
        var language = imports.language;
        var complete = imports["language.complete"];
        
        function getTabHtml(tab) {
            return tab.pane.aml.getPage("editor::" + tab.editorType).$ext;
        }
        
        function afterCompletePopup(callback) {
            setTimeout(function() {
                var el = document.getElementsByClassName("ace_autocomplete")[0];
                if (!el || el.style.display === "none")
                    return afterCompletePopup(callback);
                callback(el);
            }, 50);
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
                this.timeout(5000);
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
                            if (!complete.getContinousCompletionRegex("javascript")) {
                                return language.getWorker(function(err, worker) {
                                    worker.on("setCompletionRegex", function(e) {
                                        if (e.data.language === "javascript")
                                            setTimeout(done);
                                    });
                                });
                            }
                            done();
                        });
                    }, 50);
                });
                
                it("has three markers initially", function(done) {
                    jsSession.on("changeAnnotation", function onAnnos() {
                        if (!jsSession.getAnnotations().length)
                            return;
                        jsSession.off("changeAnnotation", onAnnos);
                        expect(jsSession.getAnnotations()).to.have.length(3);
                        done();
                    });
                });
                
                it('can be changed to have only one marker', function(done) {
                    jsSession.setValue("foo;");
                    jsSession.on("changeAnnotation", function onAnnos() {
                        if (!jsSession.getAnnotations().length)
                            return;
                        jsSession.off("changeAnnotation", onAnnos);
                        expect(jsSession.getAnnotations()).to.have.length(1);
                        done();
                    });
                });
                
                it('shows a word completer popup on keypress', function(done) {
                    jsSession.setValue("conny con");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("n");
                    afterCompletePopup(function(el) {
                        expect.html(el).text(/conny/);
                        done();
                    });
                });
                
                it('shows an inference completer popup on keypress', function(done) {
                    jsSession.setValue("console.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompletePopup(function(el) {
                        expect.html(el).text(/log\(/);
                        done();
                    });
                });
                
                it('always does dot completion', function(done) {
                    language.setContinuousCompletionEnabled(false);
                    jsSession.setValue("console");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput(".");
                    afterCompletePopup(function(el) {
                        expect.html(el).text(/log\(/);
                        language.setContinuousCompletionEnabled(false);
                        done();
                    });
                });
            });
        });
        
        onload && onload();
    }
});