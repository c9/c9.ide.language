define(function(require, exports, module) {
    var oop          = require("ace/lib/oop");
    var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
    
    var CLASS_SELECTED   = "item selected";
    var CLASS_UNSELECTED = "item";
    
    var ListData = function(array) {
        this.visibleItems = array || [];
        this.columns = 1;
        this.x = [];
        this.y = [];
        this.innerRowHeight = 19;
        this.rowHeight = 20;
        
        this.$selectedNode = this.root;
        
        Object.defineProperty(this, "loaded", {
            get : function(){ return this.visibleItems.length; }
        });
    };
    
    (function() {
        oop.implement(this, EventEmitter);
        
        this.updateData = function(array){
            this.visibleItems = array || [];
            
            // @TODO Deal with selection
            this._signal("change");
        }
        
        // @Harutyun Help!
        this.getEmptyMessage = function(){
            if (!this.keyword)
                return "Loading file list. One moment please...";
            else
                return "No files found that match '" + this.keyword + "'";
        }
    
        this.getDataRange = function(rows, columns, callback) {
            var view = this.visibleItems.slice(rows.start, rows.start + rows.length);        
            callback(null, view, false);
            return view;
        };
        
        this.getRange = function(top, bottom) {
            var start = Math.floor(top / this.rowHeight);
            var end = Math.ceil(bottom / this.rowHeight) + 1;
            var range = this.visibleItems.slice(start, end);
            range.count = start;
            range.size = this.rowHeight * range.count;
            return range;
        };
        
        this.getTotalHeight = function(top, bottom) {
            return this.rowHeight * this.visibleItems.length;
        };
        // todo move selection stuff out of here
        this.select = function(index) {
            this.selectNode({index: index});
        }
        this.selectNode = function(node) {
            if (!node) return;
            this.$selectedNode = node;
            this.selectedRow = node.index;
            this._signal("change");
            this._emit("select");
        };
        
        this.getNodePosition = function(node) {
            var i = node.index;
            var top = i * this.rowHeight;
            var height = this.rowHeight
            return {top: top, height: height}
        }
        
        this.findItemAtOffset = function(offset) {
            var index = Math.floor(offset / this.rowHeight);
            return {label:this.visibleItems[index], index: index};
        };
        
        function guidToShortString(guid) {
            var result = guid && guid.replace(/^[^:]+:(([^\/]+)\/)*?([^\/]*?)(\[\d+[^\]]*\])?(\/prototype)?$|.*/, "$3");
            return result && result !== "Object" ? result : "";
        }
    
        function guidToLongString(guid, name) {
            if (guid.substr(0, 6) === "local:")
                return guidToShortString(guid);
            var result = guid && guid.replace(/^[^:]+:(([^\/]+\/)*)*?([^\/]*?)$|.*/, "$1$3");
            if (!result || result === "Object")
                return "";
            result = result.replace(/\//g, ".").replace(/\[\d+[^\]]*\]/g, "");
            if (name !== "prototype")
                result = result.replace(/\.prototype$/, "");
            return result;
        }
    
        this.renderRow = function(row, builder, config) {
            var match = this.visibleItems[row];
            var html  = "";

            if (match.icon) {
                var path = define.packaged
                    ? "images/" + match.icon
                    : (this.staticPrefix || "/static") 
                        + "/plugins/c9.ide.language/images/" + match.icon;
                html = '<img src="' + path + '.png" ' + this.ieStyle + ' />';
            }
            else
                html = "<span class='img'></span>";
            
            var docHead;
            if (match.type) {
                var shortType = guidToShortString(match.type);
                if (shortType) {
                    match.meta = shortType;
                    docHead = match.name + " : " 
                        + guidToLongString(match.type) + "</div>";
                }
            }
            
            var prefix = match.identifierRegex
                ? this.calcPrefix(match.identifierRegex)
                : this.prefix;
            
            var trim = match.meta ? " maintrim" : "";
            if (!this.isInferAvailable || match.icon) {
                html += '<span class="main' + trim + '"><u>' 
                    + prefix + "</u>" + match.name.substring(prefix.length) 
                    + '</span>';
            }
            else {
                html += '<span class="main' + trim 
                    + '"><span class="deferred"><u>' + prefix + "</u>" 
                    + match.name.substring(prefix.length) + '</span></span>';
            }
            
            if (match.meta)
                html += '<span class="meta"> - ' + match.meta + '</span>';
            
            // @TODO why isn't this done when the docs show up?
            if (match.doc)
                match.$doc = '<p>' + match.doc + '</p>';
                
            if (match.icon || match.type)
                match.$doc = '<div class="code_complete_doc_head">' 
                    + (match.docHead || docHead || match.name) + '</div>' 
                    + (match.$doc || "");
            
            builder.push("<div class='" 
                + (row == this.selectedRow ? CLASS_SELECTED : CLASS_UNSELECTED) 
                + "' style='height:" + this.innerRowHeight + "px'>"
                + html + "</div>");
        };
        
        this.navigate = function(dir, startNode) {        
            if  (typeof startNode == "number")
                var index = startNode;
            else
                index = this.selectedRow || 0
            
            if (dir == "up") {
                index = Math.max(index - 1, 0)
            } else if (dir == "down") {
                index = Math.min(index + 1, this.visibleItems.length)
            }
            return {label:this.visibleItems[index], index: index};
        }
        
    }).call(ListData.prototype);
    
    return ListData;
});
