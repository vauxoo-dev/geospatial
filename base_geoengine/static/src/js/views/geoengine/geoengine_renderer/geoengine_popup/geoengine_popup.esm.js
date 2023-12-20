/** @odoo-module */

import { Component } from "@odoo/owl";

export class GeoenginePopUp extends Component {
}

GeoenginePopUp.template = "base_geoengine.GeoenginePopUp";
GeoenginePopUp.props = {
    record: {
        optional: true,
    },
    clickToHidePopup: Function,
    onInfoBoxClicked: Function,
}