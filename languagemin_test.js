/*global describe it before after  =*/

"use client";

window.connectBloxURL = -1; //"example.json";
window.lbWorkspace    = "awesomedb";

require(["lib/architect/architect", "lib/chai/chai"], function (architect, chai) {
    var expect = chai.expect;
    
    expect.setupArchitectTest([
        {
            packagePath : "plugins/c9.core/c9",
            startdate   : new Date(),
            debug       : false,
            hosted      : true,
            local       : false
        },
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        "plugins/c9.core/ext",
        "plugins/c9.core/util",
        "plugins/c9.core/http",
        "plugins/c9.ide.editors/document",
        "plugins/c9.ide.editors/undomanager",
        {
            packagePath: "plugins/c9.ide.editors/editors",
            defaultEditor: "ace"
        },
        "plugins/c9.ide.editors/editor",
        {
            packagePath : "plugins/c9.ide.ace/ace",
            staticPrefix : "plugins/c9.ide.layout.classic",
            minimal : true
        },
        "plugins/c9.ide.language/language",
        "plugins/c9.ide.language/tooltip",
        "plugins/c9.ide.language/keyhandler",
        "plugins/c9.ide.language/complete",
        "plugins/c9.ide.language/marker",
        "plugins/c9.ide.language.generic/generic",
        "plugins/c9.ide.language.javascript/javascript",
        "plugins/logicblox.language.logiql/logiql",
        "plugins/logicblox.language.logiql_commands/logiql_commands",
        {
            packagePath: "plugins/logicblox.core/logicblox",
            bloxWebURL: "http://lbdemo.c9.io/connectblox",
            fileServerURL: "http://lbdemo.c9.io",
            lbWorkspace: null
        },
        "plugins/c9.ide.keys/commands",
        
        "plugins/c9.ide.ace/min/settings",
        "plugins/c9.ide.ace/min/ui",
        "plugins/c9.ide.ace/min/api",
        "plugins/c9.ide.browsersupport/browsersupport",
        // Mock
        {
            consumes: [],
            provides : ["log", "auth.bootstrap", "clipboard", "fs", "Tab"],
            setup    : function(options, imports, register) {
                register(null, {
                    log: {},
                    "auth.bootstrap": {
                        login: function() {}
                    }
                });
            }
        },
        {
            consumes : ["ace", "c9", "commands", "language.keyhandler", "language.complete", "Document"],
            provides : [],
            setup    : main
        }
    ], architect);
    
    function main(options, imports, register) {
        var c9       = imports.c9;
        var ace      = imports.ace;
        var commands = imports.commands;
        var Document = imports.Document;
        var tabs     = c9.tabs;
        var complete = imports["language.complete"];
        
        var editor;
        
        expect.html.setConstructor(function(ace){
            if (typeof ace == "object")
                return ace.container
        });
        
        function render(){
            var changes = editor.ace.renderer.$loop.changes;
            editor.ace.renderer.$renderChanges(changes, true);
        }
        
        document.documentElement.style.paddingBottom = "33%";
        
        describe('ace', function() {
            /*
            describe("open 1", function() {
                this.timeout(10000);
                
                var sessId;
                it('should open a pane with just an editor', function(done) {
                    var doc = new Document({
                        value : "function foo(){}",
                        ace : { customType : "javascript" }
                    });
                    doc.tab = tab;

                    tab.document = doc;
                    tab.editor.loadDocument(doc);
                    
                    tabs.emit("open", {tab: tab});
                    
                    setTimeout(function(){
                        expect.html(tab.editor.ace, "document value").text(/function foo\(\)\{\}/);
                        done();
                    });
                });
            });
            */
            describe("open 2", function() {
                this.timeout(10000);
                
                it('should load a logiql example', function(done) {
                    var doc = new Document({
                        value : "person(x), name(x:n) -> string(n).\n" +
                                "parent(x,y) -> person(x), person(y).\n" +
                                "ancestor(x,y) -> person(x), person(y).\n" +
                                "ancestor(x,y) <- parent(x,y).\n" +
                                "ancestor(x,y) <- ancestor(x,z), ancestor(z,y).",
                        ace : { customType : "logiql" }
                    });

                    editor = c9.createEditor(document.body, null, 20, 20, 20, null, 200);
                    editor.loadDocument(doc);
                    
                    editor.ace.container.parentNode.style.position = "fixed";
                    
                    setTimeout(function(){
                        commands.exec("complete", editor, null, document.createEvent("KeyboardEvent"));
                        
                        setTimeout(function(){
                            expect.html(document.querySelector(".code_complete_bar")).text("ancestor");
                            complete.closeCompletionBox();
                            done();
                        }, 100);
                        
                    }, 8000);
                });
            });
            describe("gutter", function(){
                it('should inform me when I am not coding according to the standard', function(done) {
                });
                it('should warn when I make a potential error', function(done) {
                });
                it('should error when I make a syntax error', function(done) {
                });
            });
            describe("complete", function(){
                it('should complete when I hit a dott', function(done) {
                });
                it('should complete snippets', function(done) {
                });
                it('should complete new code', function(done) {
                });
            });

            
            // @todo test split api and menu
            
           if (!onload.remain){
               after(function(done){
                   editor.unload();
                   
                   document.body.style.marginBottom = "";
                   done();
               });
           }
        });
        
        onload && onload();
    }
});