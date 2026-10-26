sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/dom/includeStylesheet"
], function (UIComponent, includeStylesheet) {
  "use strict";
  return UIComponent.extend("com.intraedge.asksap.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      // Loaded from code (not from index.html) so it also works inside SAP Build Work Zone,
      // where index.html is never used. toUrl() resolves to the app's own base path.
      includeStylesheet(sap.ui.require.toUrl("com/intraedge/asksap/css/style.css"));
    }
  });
});
