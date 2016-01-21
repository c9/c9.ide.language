/*global describe it before after beforeEach onload*/

"use client";

require(["lib/architect/architect", "lib/chai/chai", "plugins/c9.ide.language/complete_util", "assert"], function (architect, chai, util, complete) {
    var expect = chai.expect;
    var assert = require("assert");
    
    util.setStaticPrefix("/static");
    
    expect.setupArchitectTest(window.plugins = [
        {
            packagePath: "plugins/c9.core/c9",
            workspaceId: "ubuntu/ip-10-35-77-180",
            startdate: new Date(),
            debug: true,
            hosted: true,
            local: false,
            davPrefix: "/",
            staticPrefix: "/static"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/http-xhr",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        {
            packagePath: "plugins/c9.core/settings",
            testing: true
        },
        "plugins/c9.core/api.js",
        {
            packagePath: "plugins/c9.ide.ui/ui",
            staticPrefix: "plugins/c9.ide.ui"
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
            packagePath: "plugins/c9.ide.ace/ace",
            staticPrefix: "plugins/c9.ide.layout.classic"
        },
        {
            packagePath: "plugins/c9.ide.language/language",
            workspaceDir: "/"
        },
        "plugins/c9.ide.language/keyhandler",
        "plugins/c9.ide.language/worker_util_helper",
        "plugins/c9.ide.language/complete",
        "plugins/c9.ide.language/tooltip",
        "plugins/c9.ide.language/marker",
        "plugins/c9.ide.language.generic/generic",
        "plugins/c9.ide.language.css/css",
        "plugins/c9.ide.language.javascript/javascript",
        "plugins/c9.ide.language.javascript.eslint/eslint",
        "plugins/c9.ide.language.javascript.infer/jsinfer",
        "plugins/c9.ide.language.javascript.tern/tern",
        "plugins/c9.ide.language.javascript.tern/architect_resolver",
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
            staticPrefix: "plugins/c9.ide.layout.classic"
        },
        "plugins/c9.ide.language.javascript.immediate/immediate",
        "plugins/c9.ide.immediate/evaluator",
        "plugins/c9.ide.immediate/evaluators/browserjs",
        "plugins/c9.ide.console/console",
        "plugins/c9.ide.ace.statusbar/statusbar",
        "plugins/c9.ide.ace.gotoline/gotoline",
        {
            packagePath: "plugins/c9.ide.language.jsonalyzer/jsonalyzer",
            bashBin: "bash",
            useCollab: false,
            useSend: true,
            homeDir: "~",
            workspaceDir: "/fake_root/",
        },
        "plugins/c9.ide.language.jsonalyzer/mock_collab",
        
        // Mock plugins
        {
            consumes: ["apf", "ui", "Plugin"],
            provides: [
                "commands", "menus", "layout", "watcher", 
                "save", "preferences", "anims", "clipboard", "auth.bootstrap",
                "info", "dialog.error", "panels", "tree", "dialog.question",
                "dialog.alert"
            ],
            setup: expect.html.mocked
        },
        {
            consumes: [
                "tabManager",
                "ace",
                "Document",
                "language.keyhandler",
                "language.complete",
                "language"
            ],
            provides: [],
            setup: main
        }
    ], architect);
    
    function main(options, imports, register) {
        var tabs = imports.tabManager;
        var ace = imports.ace;
        var Document = imports.Document;
        var language = imports.language;
        var complete = imports["language.complete"];
        var worker;
        var testHandler;
        
        util.setStaticPrefix("/static");
        complete.$setShowDocDelay(50);
        
        var timer;
        after(function() { clearTimeout(timer); });
        
        function getTabHtml(tab) {
            return tab.pane.aml.getPage("editor::" + tab.editorType).$ext;
        }

        function afterNoCompleteOpen(callback) {
            worker.once("complete", function(e) {
                assert(!e.data.matches.length, "Completion opened");
                callback();
            });
        }
        
        function afterCompleteOpen(callback, delay) {
            complete.once("showPopup", function(e) {
                e.popup.resize(true);
                var el = document.querySelector(".ace_autocomplete");
                callback(el);
            });
        }
        
        function afterCompleteDocOpen(callback, delay) {
            timer = setTimeout(function() {
                var el = document.getElementsByClassName("code_complete_doc_text")[0];
                if (!el || el.style.display === "none")
                    return afterCompleteDocOpen(callback);
                timer = setTimeout(function() {
                    callback(el);
                }, 5);
            }, delay || 5);
        }
        
        function isCompleterOpen() {
            var el = document.getElementsByClassName("ace_autocomplete")[0];
            return el && el.style.display === "none";
        }
        
        expect.html.setConstructor(function(tab) {
            if (typeof tab == "object")
                return getTabHtml(tab);
        });
        
        describe('ace', function() {
            this.timeout(30000);
            before(function(done) {
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                
                window.bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                window.bar.$ext.style.position = "fixed";
                window.bar.$ext.style.left = "20px";
                window.bar.$ext.style.right = "20px";
                window.bar.$ext.style.bottom = "20px";
                window.bar.$ext.style.height = "33%";
      
                document.body.style.marginBottom = "33%";
                
                tabs.once("ready", function(){
                    tabs.getPanes()[0].focus();
                    done();
                });
            });
            
            describe("analysis", function(){
                var jsTab;
                var jsSession;
                var completionCalls = 0;
                var predictionCalls = 0;

                before(function(done) {
                    language.getWorker(function(err, _worker) {
                        if (err) return done(err);
                        worker = _worker;
                        language.registerLanguageHandler(
                            "plugins/c9.ide.language/language_test_helper",
                            function(err, handler) {
                                if (err) return done(err);
                                testHandler = handler;
                                testHandler.on("complete_called", function() {
                                    completionCalls++;
                                });
                                testHandler.on("complete_predict_called", function() {
                                    predictionCalls++;
                                });
                                done();
                            });
                        }
                    );
                });
                
                // Setup
                beforeEach(function(done) {
                    completionCalls = 0;
                    tabs.getTabs().forEach(function(tab) {
                        tab.close(true);
                    });
                    // tab.close() isn't quite synchronous, wait for it :(
                    complete.closeCompletionBox();
                    setTimeout(function() {
                        tabs.openFile("/language.js", function(err, tab) {
                            if (err) return done(err);
                            
                            jsTab = tab;
                            jsSession = jsTab.document.getSession().session;
                            expect(jsSession).to.not.equal(null);
                            setTimeout(function() {
                                complete.closeCompletionBox();
                                done();
                            });
                        });
                    }, 0);
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
                
                it('parses jsx', function(done) {
                    jsSession.setValue("x = <a/>;");
                    jsSession.on("changeAnnotation", function onAnnos() {
                        var annos = jsSession.getAnnotations();
                        if (!annos.length)
                            return;
                        if (annos.some(function(a) { // annotations for previous file
                            return a.text.match(/language.*never used/);
                        }))
                            return;
                        jsSession.off("changeAnnotation", onAnnos);
                        expect(annos).to.have.length(1);
                        expect(annos[0].text).contain("x is not defined");
                        done();
                    });
                });
                
                it('shows a word completer popup on keypress', function(done) {
                    jsSession.setValue("conny; con");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("n");
                    afterCompleteOpen(function(el) {
                        expect.html(el).text(/conny/);
                        done();
                    });
                });
                
                it('shows a word completer popup for things in comments', function(done) {
                    jsSession.setValue("// conny\nco");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0} });
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
                        language.setContinuousCompletionEnabled(true);
                        done();
                    });
                });
                
                it('shows a documentation popup in completion', function(done) {
                    jsSession.setValue("console.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompleteDocOpen(function(el) {
                        expect.html(el).text(/Prints to stdout/);
                        done();
                    });
                });
                
                it('does continuous completion for CSS if you just typed one character', function(done) {
                    tabs.openFile("/test.css", function(err, tab) {
                        if (err) return done(err);
                        
                        tabs.focusTab(tab);
                        // We get a tab, but it's not done yet, so we wait
                        setTimeout(function() {
                            tab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 4 }, end: { row: 1, column: 4 } });
                            tab.editor.ace.onTextInput("f");
                            afterCompleteOpen(function(el) {
                                expect.html(el).text(/first-child/);
                                done();
                            });
                        });
                    });
                });
                
                it('does continuous completion for CSS', function(done) {
                    tabs.openFile("/test.css", function(err, tab) {
                        if (err) return done(err);
                        
                        tabs.focusTab(tab);
                        // We get a tab, but it's not done yet, so we wait
                        setTimeout(function() {
                            tab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 4 }, end: { row: 1, column: 4 } });
                            tab.editor.ace.onTextInput("font-f");
                            afterCompleteOpen(function(el) {
                                expect.html(el).text(/font-family/);
                                done();
                            });
                        });
                    });
                });
                
                it('shows a word completer in an immediate tab', function(done) {
                    tabs.open(
                        {
                            active: true,
                            editorType: "immediate"
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
                            active: true,
                            editorType: "immediate"
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
                
                it("doesn't show a word completer when there are contextual completions", function(done) {
                    jsSession.setValue("// logaritm\nconsole.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompleteOpen(function(el) {
                        assert(!el.textContent.match(/logarithm/));
                        done();
                    });
                });
                
                it("completes with parentheses insertion", function(done) {
                    jsSession.setValue("// logaritm\nconsole.");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("l");
                    afterCompleteOpen(function(el) {
                        jsTab.editor.ace.keyBinding.onCommandKey({ preventDefault: function() {} }, 0, 13);
                        setTimeout(function() {
                            assert(jsSession.getValue().match(/console.log\(\)/));
                            done();
                        });
                    });
                });
                
                it("completes local functions with parentheses insertion", function(done) {
                    jsSession.setValue('function foobar() {}\nfoo');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("b");
                    afterCompleteOpen(function(el) {
                        jsTab.editor.ace.keyBinding.onCommandKey({ preventDefault: function() {} }, 0, 13);
                        setTimeout(function() {
                            assert(jsSession.getValue().match(/foobar\(\)/));
                            done();
                        });
                    });
                });
                
                it("completes without parentheses insertion in strings", function(done) {
                    jsSession.setValue('function foobar() {}\n\"foo');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("b");
                    afterCompleteOpen(function(el) {
                        jsTab.editor.ace.keyBinding.onCommandKey({ preventDefault: function() {} }, 0, 13);
                        setTimeout(function() {
                            assert(jsSession.getValue().match(/"foobar/));
                            assert(!jsSession.getValue().match(/"foobar\(\)/));
                            done();
                        });
                    });
                });
                
                it("completes following local dependencies", function(done) {
                    jsSession.setValue('var test2 = require("./test2.js");\ntest2.');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("h");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/hoi/));
                        done();
                    });
                });
                
                it("completes following local with absolute paths", function(done) {
                    jsSession.setValue('var ext = require("plugins/c9.dummy/dep");\next.');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("e");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/export3/));
                        assert(el.textContent.match(/export4/));
                        done();
                    });
                });
                
                it("completes following local dependencies with absolute paths and common js style exports", function(done) {
                    jsSession.setValue('var ext = require("plugins/c9.dummy/dep-define");\next.');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("e");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/export1/));
                        assert(el.textContent.match(/export2/));
                        done();
                    });
                });
                
                it("doesn't show default browser properties like onabort for global completions", function(done) {
                    jsSession.setValue('// function onlyShowMe() {}; \no');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("n");
                    afterCompleteOpen(function(el) {
                        assert(!el.textContent.match(/onabort/));
                        done();
                    });
                });
                
                it("shows default browser properties like onabort when 3 characters were typed", function(done) {
                    jsSession.setValue('// function onlyShowMeAndMore() {};\non');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("a");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/onabort/));
                        done();
                    });
                });
                
                it("shows no self-completion for 'var bre'", function(done) {
                    jsSession.setValue('var ');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("bre");
                    afterCompleteOpen(function(el) {
                        assert(!el.textContent.match(/bre\b/));
                        assert(el.textContent.match(/break/));
                        done();
                    });
                });
                
                it("shows word completion for 'var b'", function(done) {
                    jsSession.setValue('// blie\nvar ');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("b");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/blie/));
                        done();
                    });
                });
                
                it("shows word completion for 'var bre'", function(done) {
                    jsSession.setValue('// breedbeeld\nvar ');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("bre");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/breedbeeld/));
                        done();
                    });
                });
                
                it("shows no self-completion for 'function blie'", function(done) {
                    jsSession.setValue('function bli');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("e");
                    afterNoCompleteOpen(done);
                });
                
                it("shows no completion for 'function blie(param'", function(done) {
                    jsSession.setValue('function blie(para');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("m");
                    afterNoCompleteOpen(done);
                });
                
                it.skip("shows word completion for 'function blie(param'", function(done) {
                    jsSession.setValue('function parametric() {}\nfunction blie(para');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("m");
                    afterCompleteOpen(function(el) {
                        assert(!el.textContent.match(/parapara/));
                        assert(el.textContent.match(/parametric/));
                        done();
                    });
                });
                
                it("shows no self-completion for 'x={ prop'", function(done) {
                    jsSession.setValue('x={ pro');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("p");
                    afterNoCompleteOpen(done);
                });
                
                it("shows no function completion for 'x={ prop: 2 }'", function(done) {
                    jsSession.setValue('function propAccess() {}\nx={ pro: 2 }');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 7 }, end: { row: 1, column: 7 } });
                    jsTab.editor.ace.onTextInput("p");
                    afterCompleteOpen(function(el) {
                        assert(!el.textContent.match(/propAccess\(\)/));
                        assert(el.textContent.match(/propAccess/));
                        done();
                    });
                });
                
                it("shows completion for '{ prop: fo'", function(done) {
                    jsSession.setValue('function foo() {}\n{ prop: f');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 2, column: 0 }, end: { row: 2, column: 0 } });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/foo\(\)/));
                        done();
                    });
                });
                
                it("extracts types from comments", function(done) {
                    jsSession.setValue('/**\ndocs be here\n@param {String} text\n*/\nfunction foo(text) {}\nf');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 10, column: 0 }, end: { row: 10, column: 0 } });
                    jsTab.editor.ace.onTextInput("o");

                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/foo\(text\)/));
                        afterCompleteDocOpen(function(el) {
                            assert(el.textContent.match(/string/i));
                            assert(el.textContent.match(/docs/i));
                            done();
                        });
                    });
                });
                
                it("supports linting basic es6", function(done) {
                    tabs.openFile("/test_es6.js", function(err, _tab) {
                        if (err) return done(err);
                        
                        var tab = _tab;
                        tabs.focusTab(tab);
                        var session = tab.document.getSession().session;
                        
                        session.on("changeAnnotation", testAnnos);
                        testAnnos();
                        
                        function testAnnos() {
                            var annos = session.getAnnotations();
                            if (!annos.length)
                                return;
                            session.off("changeAnnotation", testAnnos);
                            assert(annos.length === 1);
                            assert(annos[0].text.match(/param2.*defined/));
                            done();
                        }
                    });
                });
                
                it("doesn't assume undeclared vars are functions", function(done) {
                    jsSession.setValue('window[imUndefined] = function(json) {};\n\
                        var unassigned;\n\
                        ');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 10, column: 0 }, end: { row: 10, column: 0 } });
                    jsTab.editor.ace.onTextInput("u");
                    afterCompleteOpen(function(el) {
                        assert(el.textContent.match(/unassigned/));
                        assert(!el.textContent.match(/unassigned\(/));
                        done();
                    });
                });
                
                it("doesn't assume arrays are optional", function(done) {
                    jsSession.setValue('function myFun(arr){}\nvar a = []\nmyFun(a)\nmyF');
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 10, column: 0 }, end: { row: 10, column: 0 } });
                    jsTab.editor.ace.onTextInput("u");
                    afterCompleteDocOpen(function(el) {
                        assert(el.textContent.match(/myFun\(arr.*Array/));
                        done();
                    });
                });
                
                it("supports warnings for Cloud9's plugin unload event", function(done) {
                    tabs.openFile("/plugins/c9.dummy/architect_test_dummy.js", function(err, _tab) {
                        if (err) return done(err);
                        
                        var tab = _tab;
                        tabs.focusTab(tab);
                        var session = tab.document.getSession().session;
                        
                        session.on("changeAnnotation", testAnnos);
                        testAnnos();
                        
                        function testAnnos() {
                            var annos = session.getAnnotations();
                            if (!annos.length)
                                return;
                            annos.sort(function(a,b) {return a.row - b.row});
                            session.off("changeAnnotation", testAnnos);
                            var foundBar;
                            var foundLoaded;
                            annos.forEach(function(anno) {
                                if (anno.text.match(/bar.*unload/))
                                    foundBar = true;
                                if (anno.text.match(/loaded.*unload/))
                                    foundLoaded = true;
                            });
                            assert(foundBar && foundLoaded);
                            done();
                        }
                    });
                });
                
                it("caches across expression prefixes", function(done) {
                    jsSession.setValue("_collin; _c");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("rry _co");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 1);
                            // Normally typing "_corry _c" would show "_corry" in the completion,
                            // but since JavaScript is supposed to have a getCacheCompletionRegex set,
                            // a cached results should be used that doesn't have "_corry" yet
                            assert(!el.textContent.match(/_corry/));
                            assert(el.textContent.match(/_collin/));
                            done();
                        });
                    });
                });
                
                it("caches across expression prefixes, including 'if(' and 'if ('", function(done) {
                    jsSession.setValue("b_collin; b_c");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("rry if(if (b_co");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 1);
                            assert(el.textContent.match(/b_corry/)); // local_completer secretly ran a second time
                            assert(el.textContent.match(/b_collin/));
                            done();
                        });
                    });
                });
                
                it("doesn't cache across expression prefixes in assigments", function(done) {
                    jsSession.setValue("_collin; _c");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("rry=_co");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 2);
                            assert(el.textContent.match(/_corry/));
                            assert(el.textContent.match(/_collin/));
                            done();
                        });
                    });
                });
                
                it("doesn't cache with expression prefixes based on function names or params", function(done) {
                    jsSession.setValue("ffarg; function ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("ff");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        assert(el.textContent.match(/ffarg/));
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("oo(ff");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 2);
                            // cache got cleared so we have farg here now
                            assert(el.textContent.match(/ffoo/));
                            assert(el.textContent.match(/ffarg/));
                            complete.closeCompletionBox();
                            jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                            jsTab.editor.ace.onTextInput("ort) ff");
                            afterCompleteOpen(function(el) {
                                assert.equal(completionCalls, 3);
                                // cache got cleared so we have fort here now
                                assert(el.textContent.match(/ffoo/));
                                assert(el.textContent.match(/ffort/));
                                assert(el.textContent.match(/ffarg/));
                                done();
                            });
                        });
                    });
                });
                
                it("doesn't do prefix-caching outside of a function context", function(done) {
                    jsSession.setValue("function foo() { ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("f");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("} f");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 2);
                            done();
                        });
                    });
                });
                
                it("doesn't do prefix-caching after property access", function(done) {
                    jsSession.setValue("console.l");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("g c");
                        afterCompleteOpen(function(el) {
                            assert(el.textContent.match(/console/), el.textContent);
                            assert.equal(completionCalls, 2, "Should refetch after property access: " + completionCalls);
                            done();
                        });
                    });
                });
                
                it.skip('predicts console.log() when typing just consol', function(done) {
                    jsSession.setValue("conso");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("l");
                    worker.once("complete_predict_called", function() {
                        assert.equal(completionCalls, 1);
                        afterCompleteOpen(function retry(el) {
                            assert.equal(completionCalls, 1);
                            if (!el.textContent.match(/log/))
                                return afterCompleteOpen(retry);
                            done();
                        });
                    });
                });
                
                it('shows the current identifier as the top result', function(done) {
                    jsSession.setValue("concat; conso; cons");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        assert(el.textContent.match(/conso(?!l).*console/));
                        done();
                    });
                });
                
                it('shows the current identifier as the top result, and removes it as you keep typing', function(done) {
                    jsSession.setValue("2; concat; conso; cons");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("o");
                    afterCompleteOpen(function(el) {
                        assert.equal(completionCalls, 1);
                        assert(el.textContent.match(/conso(?!l).*console/));

                        complete.closeCompletionBox();
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0 } });
                        jsTab.editor.ace.onTextInput("l");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 1);
                            assert(!el.textContent.match(/conso(?!l)/));
                            assert(el.textContent.match(/console/));
                            done();
                        });
                    });
                });
                
                it("completes php variables in short php escapes", function(done) {
                    tabs.openFile("/test_broken.php", function(err, _tab) {
                        if (err) return done(err);
                        var tab = _tab;
                        tabs.focusTab(tab);
                        var session = tab.document.getSession().session;
                        
                        session.setValue("<?php $foo = 1;  ?>");
                        tab.editor.ace.selection.setSelectionRange({ start: { row: 0, column: 16 }, end: { row: 0, column: 16 } });
                        tab.editor.ace.onTextInput("$");
                        afterCompleteOpen(function(el) {
                            complete.closeCompletionBox();
                            tab.editor.ace.onTextInput("f");
                            afterCompleteOpen(function(el) {
                                assert(el.textContent.match(/foo/));
                                done();
                            });
                        });
                    });
                });
                
                it("completes php variables in long files", function(done) {
                    tabs.openFile("/test_broken.php", function(err, _tab) {
                        if (err) return done(err);
                        var tab = _tab;
                        tabs.focusTab(tab);
                        var session = tab.document.getSession().session;
                        
                        var value = "<?php\n\n";
                        for (var i = 0; i < 1000; i++) {
                            value += "$foo_" + i + " = 42;\n";
                        }
                        value = value + "?>";
                        session.setValue(value);
                        
                        tab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0 } });
                        tab.editor.ace.onTextInput("$");
                        afterCompleteOpen(function(el) {
                            complete.closeCompletionBox();
                            tab.editor.ace.onTextInput("foo_99");
                            afterCompleteOpen(function(el) {
                                assert(el.textContent.match(/foo_991/));
                                done();
                            });
                        });
                    });
                });
                
                it('starts predicting a completion immediately after an assignment', function(done) {
                    // We expect this behavior as infer_completer's predictNextCompletion()
                    // tells worker we need completion here.
                    jsSession.setValue("foo ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("=");
                    
                    testHandler.once("complete_called", function() {
                        assert.equal(completionCalls, 1);
                        jsTab.editor.ace.onTextInput(" ");
                        // Wait and see if this triggers anything
                        setTimeout(function() {
                            jsTab.editor.ace.onTextInput("f");
                            
                            afterCompleteOpen(function(el) {
                                assert.equal(completionCalls, 1);
                                assert(el.textContent.match(/foo/));
                                done();
                            });
                        }, 5);
                    });
                });
                
                it('just invokes completion once for "v1 + 1 == v2 + v"', function(done) {
                    jsSession.setValue("var v1; ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("v");
                    afterCompleteOpen(function(el) {
                        complete.closeCompletionBox();
                        jsTab.editor.ace.onTextInput("1");
                        jsTab.editor.ace.onTextInput(" ");
                        jsTab.editor.ace.onTextInput("+");
                        jsTab.editor.ace.onTextInput(" ");
                        jsTab.editor.ace.onTextInput("1");
                        jsTab.editor.ace.onTextInput(" ");
                        jsTab.editor.ace.onTextInput("=");
                        jsTab.editor.ace.onTextInput("=");
                        jsTab.editor.ace.onTextInput(" ");
                        jsTab.editor.ace.onTextInput("v");
                        afterCompleteOpen(function(el) {
                            complete.closeCompletionBox();
                            jsTab.editor.ace.onTextInput("2");
                            jsTab.editor.ace.onTextInput(" ");
                            jsTab.editor.ace.onTextInput("+");
                            jsTab.editor.ace.onTextInput(" ");
                            jsTab.editor.ace.onTextInput("v");
                            afterCompleteOpen(function(el) {
                                assert.equal(completionCalls, 1);
                                done();
                            });
                        });
                    });
                });
                
                it('just invokes completion once for "x1 + 1 == x2 + x", with some timeouts', function(done) {
                    jsSession.setValue("var x1; ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("x");
                    afterCompleteOpen(function(el) {
                        jsTab.editor.ace.onTextInput("1");
                        jsTab.editor.ace.onTextInput(" ");
                        // Allow prediction to be triggered
                        setTimeout(function() {
                            jsTab.editor.ace.onTextInput("+");
                            // Allow prediction to be triggered
                            setTimeout(function() {
                                jsTab.editor.ace.onTextInput(" ");
                                jsTab.editor.ace.onTextInput("1");
                                jsTab.editor.ace.onTextInput(" ");
                                jsTab.editor.ace.onTextInput("=");
                                jsTab.editor.ace.onTextInput("=");
                                // Allow prediction to be triggered
                                setTimeout(function() {
                                    jsTab.editor.ace.onTextInput(" ");
                                    jsTab.editor.ace.onTextInput("x");
                                    afterCompleteOpen(function(el) {
                                        complete.closeCompletionBox();
                                        jsTab.editor.ace.onTextInput("2");
                                        jsTab.editor.ace.onTextInput(" ");
                                        jsTab.editor.ace.onTextInput("+");
                                        jsTab.editor.ace.onTextInput(" ");
                                        jsTab.editor.ace.onTextInput("x");
                                        afterCompleteOpen(function(el) {
                                            assert.equal(completionCalls, 1);
                                            done();
                                        });
                                    });
                                }, 5);
                            }, 5);
                        }, 5);
                    });
                });
                
                it('calls completion twice for "var y; ...", "var v; ..."', function(done) {
                    jsSession.setValue("var y1; ");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("y");
                    afterCompleteOpen(function(el) {
                        complete.closeCompletionBox();
                        jsSession.setValue("var v1; ");
                        jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                        jsTab.editor.ace.onTextInput("v");
                        afterCompleteOpen(function(el) {
                            assert.equal(completionCalls, 2);
                            done();
                        });
                    });
                });
                
                it("doesn't start predicting completion immediately after a newline", function(done) {
                    // We expect this behavior as infer_completer's predictNextCompletion()
                    // tells worker we need completion here.
                    jsSession.setValue("var foo;");
                    jsTab.editor.ace.selection.setSelectionRange({ start: { row: 1, column: 0 }, end: { row: 1, column: 0} });
                    jsTab.editor.ace.onTextInput("\n");
                    
                    setTimeout(function() {
                        jsTab.editor.ace.onTextInput("\nf");
                        testHandler.once("complete_called", function() {
                            assert.equal(completionCalls, 1);
                            done();
                        });
                    }, 50);
                });
            });
        });
        
        onload && onload();
    }
});
