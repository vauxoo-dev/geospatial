/** @odoo-module **/

export const CUSTOM_LAYERS = [
    {
        layerName: 'satellite',
        layerURL: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token=',
        image: "base_geoengine/static/src/images/satellite_view.png"
    },
    {
        layerName: 'street',
        layerURL: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=',
        image: "base_geoengine/static/src/images/street_view.png"
    },
    {
        layerName: 'outdoors',
        layerURL: 'https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/{z}/{x}/{y}?access_token=',
        image: "base_geoengine/static/src/images/outdoor_view.png"
    }
]
export const FEATURE_OPACITY = 0.2;
export  const LAND_TYPES = [
    {
        name: "Field",
        color: "#952323"
    },
    {
        name: "Animal",
        color: "#82CD47"
    },
    {
        name: "Bed",
        color: "#F78CA2"
    },
    {
        name: "Irrigation",
        color: "#435334"
    },
    {
        name: "Trial",
        color: "#E7B10A"
    },
    {
        name: "Buffer",
        color: "#940B92"
    },
    {
        name: "Storage",
        color: "#FFEA20"
    },
    {
        name: "Building",
        color: "#0CECDD"
    },
    {
        name: "Other",
        color: "#FF0075"
    },
    {
        name: "None",
        color: "#D0D4CA"
    }
];
export const VIEW_TYPE_GEOENGINE = 'geoengine';

