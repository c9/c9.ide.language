/*global describe it before after  =*/

"use client";

require(["lib/architect/architect", "lib/chai/chai"], function (architect, chai, baseProc) {
    var expect = chai.expect;
    
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
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        {
            packagePath : "plugins/c9.ide.ace/ace",
            staticPrefix : "plugins/c9.ide.layout.classic"
        },
        {
            packagePath: "plugins/c9.ide.language/language",
            workspaceDir : baseProc
        },
        "plugins/c9.ide.language/keyhandler",
        "plugins/c9.ide.language/complete",
        "plugins/c9.ide.language/tooltip",
        "plugins/c9.ide.language/marker",
        "plugins/c9.ide.language.generic/generic",
        "plugins/c9.ide.language.javascript/javascript",
        "plugins/c9.ide.keys/commands",
        "plugins/c9.fs/proc",
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        "plugins/c9.fs/fs",
        "plugins/c9.ide.browsersupport/browsersupport",
        "plugins/c9.ide.ui/menus",
        
        // todo move to mock?
        "plugins/c9.ide.dialog/dialog",
        "plugins/c9.ide.dialog.common/alert",
        
        // Mock plugins
        {
            consumes : ["apf", "ui", "Plugin"],
            provides : [
                "commands", "menus", "layout", "watcher", 
                "save", "preferences", "anims", "clipboard", "auth.bootstrap",
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["tabManager", "ace"],
            provides : [],
            setup    : main
        }
    ], architect);
    
    function main(options, imports, register) {
        var tabs    = imports.tabManager;
        var ace     = imports.ace;
        
        function getTabHtml(tab){
            return tab.pane.aml.getPage("editor::" + tab.editorType).$ext
        }
        
        expect.html.setConstructor(function(tab){
            if (typeof tab == "object")
                return getTabHtml(tab);
        });
        
        describe('ace', function() {
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                tabs.getPanes()[0].focus();
                
                window.bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                window.bar.$ext.style.position = "fixed";
                window.bar.$ext.style.left = "20px";
                window.bar.$ext.style.right = "20px";
                window.bar.$ext.style.bottom = "20px";
                window.bar.$ext.style.height = "33%";
      
                document.body.style.marginBottom = "33%";
                done();
            });
            
            describe("open", function(){
                this.timeout(10000);
                
                var sessId;
                it('should should be properly architect configured and not fail', function(done) {
                    done();
                });
//                it('should open a pane with just an editor', function(done) {
//                    tabs.openFile("file.js", function(err, tab){
//                        expect(tabs.getTabs()).length(1);
//                        
//                        expect(tab.document.title).equals("file.js");
//                        done();
//                    });
//                });
//                it('should handle multiple documents in the same pane', function(done) {
//                    tabs.openFile("listing.json", function(err, tab){
//                        expect(tabs.getTabs()).length(2);
//                        
//                        tab.activate();
//                        
//                        var doc = tab.document;
//                        expect(doc.title).match(new RegExp("listing.json"));
//                        done();
//                    });
//                });
            });
//            describe("clear(), getState() and setState()", function(){
//                var state, info = {};
//                
//                it('should retrieve the state', function(done) {
//                    state = tabs.getState();
//                    info.pages = tabs.getTabs().map(function(tab){
//                        return tab.path || tab.id;
//                    });
//                    done();
//                });
//                it('should clear all tabs and pages', function(done) {
//                    tabs.getPanes()[0];
//                    var pages = tabs.getTabs();
//                    tabs.clear(true, true); //Soft clear, not unloading the pages
//                    expect(tabs.getTabs(), "pages").length(0);
//                    expect(tabs.getPanes(), "tabManager").length(0);
//                    //expect(pane.getTabs(), "aml").length(0);
//                    done();
//                });
//                it('should restore the state', function(done) {
//                    tabs.setState(state, false, function(err){
//                        if (err) throw err.message;
//                    });
//                    var l = info.pages.length;
//                    expect(tabs.getTabs()).length(l);
//                    expect(tabs.getPanes()[0].getTabs()).length(l);
//                    expect(tabs.focussedTab.pane.getTabs()).length(l);
//                    
//                    expect(tabs.getTabs().map(function(tab){
//                        return tab.path || tab.id;
//                    })).to.deep.equal(info.pages);
//                    done();
//                });
//            });
//            describe("split(), pane.unload()", function(){
//                it('should split a pane horizontally, making the existing pane the left one', function(done) {
//                    var pane = tabs.focussedTab.pane;
//                    var righttab = pane.hsplit(true);
//                    tabs.focussedTab.attachTo(righttab);
//                    done();
//                });
//                it('should remove the left pane from a horizontal split', function(done) {
//                    var pane  = tabs.getPanes()[0];
//                    var tab = tabs.getPanes()[1].getTab();
//                    pane.unload();
//                    expect(tabs.getPanes()).length(1);
//                    expect(tabs.getTabs()).length(2);
//                    tabs.focusTab(tab);
//                    done();
//                });
//            });
//            describe("setOption()", function(){
//                this.timeout(10000);
//                
//                it('should change a theme', function(done) {
//                    var editor = tabs.focussedTab.editor;
//                    ace.on("themeInit", function setTheme(){
//                        ace.off("theme.init", setTheme);
//                        expect.html(getTabHtml(tabs.focussedTab).childNodes[1]).className("ace-monokai");
//                        editor.setOption("theme", "ace/theme/textmate");
//                        done();
//                    });
//                    editor.setOption("theme", "ace/theme/monokai");
//                });
//            });
            
            // @todo test split api and menu
            
           if (!onload.remain){
               after(function(done){
                   tabs.unload();
                   
                   document.body.style.marginBottom = "";
                   done();
               });
           }
        });
        
        onload && onload();
    }
});