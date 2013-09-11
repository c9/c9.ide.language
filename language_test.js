/*global describe it before after  =*/

require(["lib/architect/architect", "lib/chai/chai"], function (architect, chai) {
    var expect = chai.expect;
    
    architect.resolveConfig([
        {
            packagePath  : "plugins/c9.core/c9",
            workspaceId  : "ubuntu/ip-10-35-77-180",
            startdate    : new Date(),
            debug        : true,
            smithIo      : "{\"prefix\":\"/smith.io/server\"}",
            hosted       : true,
            local        : false,
            davPrefix    : "/",
            staticPrefix : "/static"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/events",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        "plugins/c9.core/settings",
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
        "plugins/c9.ide.editors/tabs",
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        {
            packagePath : "plugins/c9.ide.ace/ace",
            staticPrefix : "plugins/c9.ide.layout.classic"
        },
        "plugins/c9.ide.language/language",
        "plugins/c9.ide.language/keyhandler",
        "plugins/c9.ide.language/complete",
        "plugins/c9.ide.language/marker",
        "plugins/c9.ide.language.generic/generic",
        "plugins/c9.ide.language.javascript/javascript",
        "plugins/c9.ide.keys/commands",
        "plugins/c9.fs/proc",
        {
            packagePath: "plugins/c9.vfs.client/vfs_client",
            smithIo     : {
                "prefix": "/smith.io/server"
            }
        },
        "plugins/c9.ide.auth/auth",
        "plugins/c9.fs/fs",
        "plugins/c9.ide.browsersupport/browsersupport",
        
        // Mock plugins
        {
            consumes : ["emitter", "apf", "ui"],
            provides : [
                "commands", "menus", "layout", "watcher", 
                "save", "preferences", "anims", "clipboard"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["tabs", "ace"],
            provides : [],
            setup    : main
        }
    ], function (err, config) {
        if (err) throw err;
        var app = architect.createApp(config);
        app.on("service", function(name, plugin){ plugin.name = name; });
    });
    
    function main(options, imports, register) {
        var tabs    = imports.tabs;
        var ace     = imports.ace;
        
        function getPageHtml(tab){
            return tab.pane.aml.getPage("editor::" + tab.editorType).$ext
        }
        
        expect.html.setConstructor(function(tab){
            if (typeof tab == "object")
                return getPageHtml(tab);
        });
        
        describe('ace', function() {
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                tabs.getPanes()[0].focus();
                
                bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                bar.$ext.style.position = "fixed";
                bar.$ext.style.left = "20px";
                bar.$ext.style.right = "20px";
                bar.$ext.style.bottom = "20px";
                bar.$ext.style.height = "33%";
      
                document.body.style.marginBottom = "33%";
                done();
            });
            
            describe("open", function(){
                this.timeout(10000);
                
                var sessId;
                it('should open a pane with just an editor', function(done) {
                    tabs.openFile("file.js", function(err, tab){
                        expect(tabs.getPages()).length(1);
                        
                        expect(tab.document.title).equals("file.js");
                        done();
                    });
                });
//                it('should handle multiple documents in the same pane', function(done) {
//                    tabs.openFile("listing.json", function(err, tab){
//                        expect(tabs.getPages()).length(2);
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
//                    info.pages = tabs.getPages().map(function(tab){
//                        return tab.path || tab.id;
//                    });
//                    done();
//                });
//                it('should clear all tabs and pages', function(done) {
//                    tabs.getPanes()[0];
//                    var pages = tabs.getPages();
//                    tabs.clear(true, true); //Soft clear, not unloading the pages
//                    expect(tabs.getPages(), "pages").length(0);
//                    expect(tabs.getPanes(), "tabs").length(0);
//                    //expect(pane.getPages(), "aml").length(0);
//                    done();
//                });
//                it('should restore the state', function(done) {
//                    tabs.setState(state, false, function(err){
//                        if (err) throw err.message;
//                    });
//                    var l = info.pages.length;
//                    expect(tabs.getPages()).length(l);
//                    expect(tabs.getPanes()[0].getPages()).length(l);
//                    expect(tabs.focussedPage.pane.getPages()).length(l);
//                    
//                    expect(tabs.getPages().map(function(tab){
//                        return tab.path || tab.id;
//                    })).to.deep.equal(info.pages);
//                    done();
//                });
//            });
//            describe("split(), pane.unload()", function(){
//                it('should split a pane horizontally, making the existing pane the left one', function(done) {
//                    var pane = tabs.focussedPage.pane;
//                    var righttab = pane.hsplit(true);
//                    tabs.focussedPage.attachTo(righttab);
//                    done();
//                });
//                it('should remove the left pane from a horizontal split', function(done) {
//                    var pane  = tabs.getPanes()[0];
//                    var tab = tabs.getPanes()[1].getPage();
//                    pane.unload();
//                    expect(tabs.getPanes()).length(1);
//                    expect(tabs.getPages()).length(2);
//                    tabs.focusPage(tab);
//                    done();
//                });
//            });
//            describe("setOption()", function(){
//                this.timeout(10000);
//                
//                it('should change a theme', function(done) {
//                    var editor = tabs.focussedPage.editor;
//                    ace.on("themeInit", function setTheme(){
//                        ace.off("theme.init", setTheme);
//                        expect.html(getPageHtml(tabs.focussedPage).childNodes[1]).className("ace-monokai");
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