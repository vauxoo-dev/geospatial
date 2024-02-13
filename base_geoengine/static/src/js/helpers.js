/** @odoo-module **/

import { FEATURE_TYPES, PROJECT_AGRICULTURE_LAND_MODEL, LAND_TYPES, FEATURE_OPACITY } from "./constants"


// const ormService = useService("orm");

/**
 * Generates a unique ID.
 *
 * This function uses the `crypto.getRandomValues` method to generate a unique ID. 
 * It creates a new typed array with one element (`Uint32Array(1)`) and fills it with cryptographically strong random values.
 *
 * @returns {number} The generated unique ID, which is a number.
 */
export function isTouchDevice() {
    return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Generates a unique ID.
 *
 * This function uses the `crypto.getRandomValues` method to generate a unique ID. 
 * It creates a new typed array with one element (`Uint32Array(1)`) and fills it with cryptographically strong random values.
 *
 * @returns {number} The generated unique ID, which is a number.
 */
export function uniqueID() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Generates GeoPoints and adds them to the provided source.
 *
 * @param {Array} data - An array of objects. Each object has two keys: 'data' and 'evalContext'.
 * 'data' is an object with 'longitude', 'latitude', and 'name' properties.
 * 'evalContext' is an optional object with an 'id' property.
 * @param {ol.source.Vector} source - The OpenLayers Vector source to which the GeoPoints will be added.
 */
export function generateGeoPoints(data, source) {
    data.forEach(geoPoint => {
        const { longitude, latitude, name } = geoPoint.data
        const { id } = geoPoint.evalContext;
        const { geopointStyle } = createGeoPointStyle(String(id))
        const feature = new ol.Feature({
            geometry: new ol.geom.Point([longitude, latitude]),
            labelPoint: new ol.geom.Point([longitude, latitude]),
        })
        feature.setStyle(geopointStyle)
        feature.set("id", id)
        feature.set("coordinates", [longitude, latitude])
        feature.set("landName", name)
        feature.set("type", FEATURE_TYPES.GEOPOINT)
        source.addFeature(feature);
    })
}


/**
 * Creates a style for geopoint features on the map.
 *
 * This function creates a new OpenLayers style object with a circle image and a text label. 
 * The circle is filled with color '#C70039' and has a white stroke. 
 * The text label is styled with a bold 8px Calibri font, filled with black color and has a white stroke.
 * If no label is provided, an empty string is used as the default.
 * The function also creates a new empty vector source.
 *
 * @param {string|null} label - The text label for the style. If null, an empty string is used.
 * @returns {Object} An object containing the created vector source and geopoint style.
 */
export function createGeoPointStyle(label = null) {
    const vectorSource = new ol.source.Vector({});
    const geopointStyle = new ol.style.Style({
        image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({ color: '#C70039' }),
            stroke: new ol.style.Stroke({
                color: 'white', width: 1
            })
        }),
        text: new ol.style.Text({
            text: label ?? "",
            font: 'bold 8px Calibri,sans-serif',
            fill: new ol.style.Fill({ color: '#000' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
        })
    });
    return { vectorSource, geopointStyle }
}

  /**
     * Creates a new land style object with the specified color and label.
     * @param {string} color - The color of the land style in hex format.
     * @param {string} label - The label to display on the land style.
     * @returns {ol.style.Style} A new land style object.
     */
export function createLandStyle(color = "#0000f5", label = null) {
    const lighterColor = chroma(color).alpha(FEATURE_OPACITY).css();
    const darkenColor = chroma(color).darken(1).css();
    const { Fill, Stroke, Style, Text } = ol.style;
    const fill = new Fill({ color: lighterColor });
    const stroke = new Stroke({
        color: darkenColor,
        width: 5,
    });
    const text = new Text({
        font: 'bold 10px Calibri,sans-serif',
        overflow: true,
        text: label ?? "",
        fill: new Fill({
            color: '#000',
        }),
        stroke: new Stroke({
            color: '#fff',
            width: 2,
        })
    });
    return new Style({
        stroke,
        fill,
        text
    });
}