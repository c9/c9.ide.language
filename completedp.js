define(function(require, exports, module) {
   
    
    var CLASS_SELECTED   = "item selected";
    var CLASS_UNSELECTED = "item";
        var guidToShortString = this.guidToShortString = function(guid) {
            var result = guid && guid.replace(/^[^:]+:(([^\/]+)\/)*?([^\/]*?)(\[\d+[^\]]*\])?(\/prototype)?$|.*/, "$3");
            return result && result !== "Object" ? result : "";
        }
    
        var guidToLongString = this.guidToLongString = function(guid, name) {
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
    
        function addStylesheetRule(cssText) {
            var s = document.styleSheets[document.styleSheets.length - 1];
            s.insertRule(cssText, s.cssRules.length);
        }
        
        var iconClass = {};
        function defineIcon(icon) {
            var path = define.packaged ? "images/"
                : (this.staticPrefix || "/static") + "/plugins/c9.ide.language/images/";
                
            iconClass[icon] = "lang-icon-" + icon;
            
            var cssText = ".ace_" + iconClass[icon] + "{"
                + "background-image:url('" + path + icon + ".png')"
                + "}";
                
            addStylesheetRule(cssText);
            return iconClass[icon];
        }
        

        function tokenizeRow() {
            return [{}];
        }
        function renderLineInner(builder, row) {
            var match = this.data[row];
            
            html = "<span class='img " + (match.icon 
                ? iconClass[match.icon] || defineIcon(match.icon)
                : "" ) + "'></span>";
            
            if (match.type) {
                var shortType = guidToShortString(match.type);
                if (shortType)
                    match.meta = shortType;
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
            
            builder.push("<div class='" 
                + (row === this.getRow() ? CLASS_SELECTED : CLASS_UNSELECTED) 
                + "'>"
                + html + "</div>");
        }
        
        function renderLine(stringBuilder, row, onlyContents, foldLine) {
            if (!onlyContents) {
                stringBuilder.push(
                    "<div class='ace_line' style='height:", this.config.lineHeight, "px'>"
                );
            }
            this.popup.$renderLineInner(stringBuilder, row);
        
            if (!onlyContents)
                stringBuilder.push("</div>");
        }
        
        module.exports = function (popup) {
            popup.session.bgTokenizer.popup = popup;
            popup.session.bgTokenizer.$tokenizeRow = tokenizeRow;
            popup.renderer.$textLayer.popup = popup;
            popup.$renderLineInner = renderLineInner;
            popup.renderer.$textLayer.$renderLine = renderLine;
        }

});
