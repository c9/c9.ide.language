/*global describe it before after beforeEach onload*/

"use client";

require(["plugins/c9.ide.language/test_base"], function(base) {
    base.setup(function(err, imports, helpers) {
        if (err) throw err;
        
        var language = imports.language;
        var chai = require("lib/chai/chai");
        var expect = chai.expect;
        var assert = require("assert");
        var tabs = imports.tabManager;
        var complete = imports["language.complete"];
        var afterNoCompleteOpen = helpers.afterNoCompleteOpen;
        var afterCompleteDocOpen = helpers.afterCompleteDocOpen;
        var afterCompleteOpen = helpers.afterCompleteOpen;
        var isCompleterOpen = helpers.isCompleterOpen;
        var getCompletionCalls = helpers.getCompletionCalls;

        describe("analysis", function(){
            var jsTab;
            var jsSession;
            
            // Setup
            beforeEach(function(done) {
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
        });
    });
});
