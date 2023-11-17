/** @odoo-module **/

/**
 * Copyright 2023 ACSONE SA/NV
 */

import {loadBundle} from "@web/core/assets";
import { session } from "@web/session";
import {registry} from "@web/core/registry";
import {useService, useOwnedDialogs} from "@web/core/utils/hooks";
import {WarningDialog, ErrorDialog} from "@web/core/errors/error_dialogs";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {FormViewDialog} from "@web/views/view_dialogs/form_view_dialog";
import {standardFieldProps} from "@web/views/fields/standard_field_props";
import { 
    CUSTOM_LAYERS,
    FEATURE_OPACITY,
    LAND_TYPES,
    VIEW_TYPE_GEOENGINE
} from "../../constants";
import {Component, onMounted, onRendered, onWillStart, useEffect, useState} from "@odoo/owl";

export class FieldGeoEngineEditMap extends Component {
    setup() {
        // Allows you to have a unique id if you put the same field in the view several times
        this.id = `map_${Date.now()}`;
        this.orm = useService("orm");
        this.addDialog = useOwnedDialogs();
        this.view = useService("view");
        this.actionService = useService("action");
        this.rpc = useService("rpc");
        this.state = useState({
            activeInteraction: {
                interactionId: null,
                element: null,
                unboundMethod: null,
            },
        })

        onWillStart(() =>
            Promise.all([
                loadBundle({
                    jsLibs: [
                        "/base_geoengine/static/lib/ol-7.2.2/ol.js",
                        "/base_geoengine/static/lib/chromajs-2.4.2/chroma.js",
                        '/base_geoengine/static/lib/geocoder-4.3.1/ol-geocoder.js'
                    ],
                    cssLibs: [
                        '/base_geoengine/static/lib/geocoder-4.3.1/ol-geocoder.css'
                    ]
                }),
            ])
        );

        // Is executed when component is mounted.
        onMounted(async () => {
            const result = await this.orm.call(
                this.props.record.resModel,
                "get_edit_info_for_geo_column",
                [this.props.name]
                );
            this.isGeoengineView = this.getViewType()
            this.projection = result.projection;
            this.defaultExtent = result.default_extent;
            this.defaultZoom = result.default_zoom;
            this.restrictedExtent = result.restricted_extent;
            this.srid = result.srid;
            this.mapBoxToken = session.map_box_token || "",
            this.createLayers(this.props.record.data?.default_map_layer);
            this.renderMap();
            this.geoIp = await this.getGeoIp();
            this.setValue(this.props.value);
            this.geoPoints = this.props.record.data.geopoint_ids?.records ?? []
            if(this.geoPoints?.length > 0) this.createCoordsTooltip()
            this.deleteMode = false;
        });

        useEffect(
            () => {
                if(this.valuesTooltipElement) this.addValuesTooltipContent();
                if(!this.props.readonly && this.map && this.props.record.data.city_id) this.setupControls()
            },
            () => [this.props.record.data]
        )

        useEffect(
            () => {
                if (this.state.activeInteraction?.interactionId) {
                    this.removeInteractionElement.classList.remove("d-none")
                }
            },
            () => [this.state.activeInteraction]
        )

        // Is executed after component is rendered. When we use pagination.
        onRendered(() => {
            this.setValue(this.props.value);
        });
    }

    /**
     * Returns the user's current location as a Promise.
     *
     * @return {Promise} A Promise that resolves to the user's current location as an array 
     * of [longitude, latitude] values.
     */
    async getGeoIp() {
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                position => {
                    const { longitude, latitude } = position.coords;
                    const coords = [longitude, latitude];
                    resolve(this.transformCoords(coords));
                },
                async () => {
                    const coords = await this.rpc("/get_geoip");
                    resolve(this.transformCoords(coords));
                }
            );
        });
    }

    /**
    * Transforms the given coordinates from EPSG:4326 to the current map projection.
    *
    * @param {Array} coords - An array of [longitude, latitude] values in EPSG:4326 format.
    * @return {Array} An array of [x, y] values in the current map projection.
    */
    transformCoords(coords) {
        return ol.proj.transform(coords, 'EPSG:4326', `EPSG:${this.srid}`);
    }

    uniqueID() {
        return crypto.getRandomValues(new Uint32Array(1))[0];
    }

    /**
     * Gets the view type from the URL hash fragment.
     * @returns {boolean} True if the view type is GeoEngine, false otherwise.
     */
    getViewType() {
        const url = new URL(window.location.href);
        const fragment = url.hash.substring(1);
        const params = new URLSearchParams(fragment);
        const viewType = params.get('view_type');
        return viewType === VIEW_TYPE_GEOENGINE
    }

    /**
     * Displays geo data on the map using the collection of features.
     */
    createVectorLayer(color="#0000f5") {
        this.features = new ol.Collection();
        this.source = new ol.source.Vector({features: this.features});
        const landStyle = this.createLandStyle(color);
        return new ol.layer.Vector({
            source: this.source,
            style: feature => {
                const label = feature.get("name");
                landStyle.getText().setText(label);
                return [landStyle];
            }
        })
    }

    /**
     * Creates a new land style object with the specified color and label.
     * @param {string} color - The color of the land style in hex format.
     * @param {string} label - The label to display on the land style.
     * @returns {ol.style.Style} A new land style object.
     */
    createLandStyle(color="#0000f5", label=null) {
        const lighterColor = chroma(color).alpha(FEATURE_OPACITY).css();
        const darkenColor = chroma(color).darken(1).css();
        const { Fill, Stroke, Style, Text } = ol.style;
        const fill = new Fill({color:lighterColor});
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

    /**
     * Call the method that creates the layer to display the geo data on the map.
     */
    createLayers(activeLayer) {
        this.vectorLayer = this.createVectorLayer("#0000f5")
        this.layer_list = []
        this.osmLayer = new ol.layer.Tile({
            source: new ol.source.OSM(),
            visible: !this.mapBoxToken,
            properties: {
                layerName: 'osm',
                image: 'base_geoengine/static/src/images/osm_view.png'
            }
        });
        this.layer_list.push(this.osmLayer)
        if (!!this.mapBoxToken) {
            CUSTOM_LAYERS.forEach(({layerName, layerURL, image}) => {
                const layer = new ol.layer.Tile({
                    source: new ol.source.XYZ({
                        url: `${layerURL}${this.mapBoxToken}`,
                    }),
                    visible: false,
                    properties: { layerName, image }
                })
                this.layer_list.push(layer)
            })
            const defaultLayer = this.layer_list.find(layer =>layer.getProperties().layerName === activeLayer)
            defaultLayer.setVisible(true)
        }
    }

    /**
     * Allows you to centre the area defined for the user.
     * If there is an item to display.
     */
    updateMapZoom() {
        if (this.source) {
            var extent = this.source.getExtent();
            var infinite_extent = [Infinity, Infinity, -Infinity, -Infinity];
            if (extent !== infinite_extent) {
                var map_view = this.map.getView();
                if (map_view) {
                    map_view.fit(extent, {maxZoom: 25});
                }
            }
        } 
    }

    /**
     * Allows you to centre the area defined for the user.
     * If there is not item to display.
     */
    updateMapEmpty() {
        const mapView = this.map.getView();
        if (mapView) {
            const extent = this.geoIp.length > 0
            ? ol.extent.boundingExtent([this.geoIp]) 
            : this.defaultExtent.replace(/\s/g, "").split(",").map((coord) => Number(coord));
            mapView.fit(extent, {maxZoom: this.defaultZoom || 15});
        }
    }

    /**
     * Based on the value passed in props, adds a new feature to the collection.
     * @param {*} value
     */
    async setValue(value) {
        if (this.map) {
            /**
             * If the value to be displayed is equal to the one passed in props, do nothing
             * otherwise clear the map and display the new value.
             */
            if (this.displayValue == value) return;
            this.displayValue = value;
            const ft = new ol.Feature({
                geometry: new ol.format.GeoJSON().readGeometry(value),
                labelPoint: new ol.format.GeoJSON().readGeometry(value),
            });
            const ftGeometry =  ft.getGeometry();
            if (ftGeometry) {
                this.mainLand = ftGeometry;
                const extent = this.mainLand.getExtent();
                this.mainLandCenter = ol.extent.getCenter(extent);
            }
            this.source.clear();
            this.source.addFeature(ft);
            if (value) {
                // if the value exists we create the values tooltip
                this.updateMapZoom();
                this.createValuesTooltip();
                if (this.props.record.data.city_id)  await this.generateChildFeatures()
                if (this.geoPoints?.length > 0) this.generateGeoPoints();
            } else {
                this.updateMapEmpty();
            }
        }
    }

    /**
    * Generates GeoPoints on the map.
    *
    * This function iterates over the `geoPoints` array and for each `geoPoint`, 
    * it creates a new OpenLayers Feature with a Point geometry using the longitude 
    * and latitude from the `geoPoint` data. It also sets the style, id, coordinates, 
    * and name of the feature. Finally, it adds the feature to the source.
    */
    generateGeoPoints() {
        this.geoPoints.forEach(geoPoint => {
            const { longitude, latitude, id, name } = geoPoint.data
            const {  geopointStyle } = this.createGeoPointStyle(String(id))
            const feature = new ol.Feature({
                geometry: new ol.geom.Point([longitude, latitude]),
                labelPoint: new ol.geom.Point([longitude, latitude]),
            })
            feature.setStyle(geopointStyle)
            feature.set("id", id)
            feature.set("coordinates", [longitude, latitude])
            feature.set("name", name)
            this.source.addFeature(feature);
        })
    }

    async generateChildFeatures() {
        const childLands = await this.orm.call(
            this.props.record.resModel,
            "get_child_lands",
            [this.props.record.data.id],
        )
        if(childLands.length <= 0) return;
        childLands.forEach(childLand => {
            const [id, name, polygonType, theGeometry] = childLand
            const ft = new ol.Feature({
                geometry: new ol.format.GeoJSON().readGeometry(theGeometry),
                labelPoint: new ol.format.GeoJSON().readGeometry(theGeometry),
            });
            const { color } = LAND_TYPES.find(landType => landType.name === polygonType)
            const label = `${polygonType} \n ${name}`
            const style = this.createLandStyle(color, label)
            ft.setStyle(style)
            ft.set("id", id)
            ft.set("landName", name)
            this.source.addFeature(ft);
        })
    }

    /**
     * This is triggered when the view changed. When we have finished drawing our geo data, or
     * when we clear the map.
     * @param {*} geometry
     */
    onUIChange(geometry) {
        var value = null;
        if (geometry) {
            value = this.format.writeGeometry(geometry);
        }
        this.props.update(value);
    }

    /**
     * Allow you to setup the trash button and the draw interaction.
     */
    setupControls() {
        if (!this.props.value && !this.drawInteraction) {
            this.drawInteraction = new ol.interaction.Draw({
                type: this.geoType,
                source: this.source,
            });
            this.map.addInteraction(this.drawInteraction);
            this.drawInteraction.on("drawstart", (e) => {
                this.createTooltipInfo();
                this.sketch = e.feature;
                this.tooltipCoord = e.coordinate;
                this.listener = this.sketch.getGeometry().on("change", e => {
                    const geom = e.target;
                    const length = ol.sphere.getLength(geom) / 1000;
                    this.infoTooltipElement.textContent = `${length.toFixed(2)} km`;
                    this.tooltipCoord = geom.getInteriorPoint().getCoordinates();
                    this.infoTooltipOverlay.setPosition(this.tooltipCoord);
                })
            })
            
            this.drawInteraction.on("drawend", async (e) => {
                this.map.removeInteraction(this.drawInteraction)
                this.drawInteraction = null;
                this.mainLand = e.feature.getGeometry();
                const extent = this.mainLand.getExtent();
                this.mainLandCenter = ol.extent.getCenter(extent);
                this.onUIChange(this.mainLand);
                this.createValuesTooltip();
                this.valuesTooltipOverlay.setPosition(this.tooltipCoord)
                this.resetInfoTooltip()
                ol.Observable.unByKey(this.listener);
            });

        } else {
            if(this.isGeoengineView) return;
            const polygonTypeControl = this.createPolygonTypeControl();
            this.polygonTypeControl = new ol.control.Control({element: polygonTypeControl});
            this.map.addControl(this.polygonTypeControl);
        }

        const fsElement = this.createFullscreenControl();
        this.fullscreenControl = new ol.control.Control({element: fsElement});
        this.map.addControl(this.fullscreenControl);

        const homeElement = this.createHomeControl();
        this.homeControl = new ol.control.Control({element: homeElement});
        this.map.addControl(this.homeControl);

        const element = this.createTrashControl();
        this.clearmapControl = new ol.control.Control({element: element});
        this.map.addControl(this.clearmapControl);

        const geopointsElement = this.createGeoPointsControl();
        this.geoPointsControl = new ol.control.Control({element: geopointsElement});
        this.map.addControl(this.geoPointsControl);

        this.removeInteractionElement = this.createRemoveInteractionControl();
        this.removeInteractionControl = new ol.control.Control({element: this.removeInteractionElement});
        this.map.addControl(this.removeInteractionControl);
        
        this.createSearchControl();

        if (!!this.mapBoxToken) {
            const elementLayers = this.createLayersControl();
            this.layersControl = new ol.control.Control({element: elementLayers});
            this.map.addControl(this.layersControl);
        }
    }

    createFullscreenControl(){
        const button = document.createElement("button");
        button.innerHTML = '<i class="fa fa-expand"/>';
        button.addEventListener("click", () => {
            const mapContainer = this.map.getTargetElement();
            if (mapContainer.requestFullscreen) {
                mapContainer.requestFullscreen();
            } else if (mapContainer.webkitRequestFullscreen) {
                mapContainer.webkitRequestFullscreen();
            } else if (mapContainer.msRequestFullscreen) {
                mapContainer.msRequestFullscreen();
            }
        });
        const element = document.createElement("div");
        element.className = "ol-control ol-fs-control ol-unselectable";
        element.appendChild(button);
        return element;
    }

    createHomeControl() {
        const button = document.createElement("button");
        button.innerHTML = '<i class="fa fa-home"/>';
        button.addEventListener("click", () => {
            this.map.getView().animate({
                center: this.mainLandCenter,
                zoom: 16,
            });
        });
        const element = document.createElement("div");
        element.className = "ol-control ol-home-control ol-unselectable";
        element.appendChild(button);
        return element
    }

    resetActiveInteraction() {
        const { interactionId, element, unboundMethod } = this.state.activeInteraction;
        const interaction = this.map.getInteractions().getArray().find(int => int.id === interactionId);
        this.map.removeInteraction(interaction);
        if(element) element.classList.remove("bg-primary", "text-white")
        this.resetInfoTooltip();
        if(unboundMethod) this.map.un("pointermove", unboundMethod)
        this.map.getViewport().style.cursor = "";
        this.removeInteractionElement.classList.add("d-none")
        this.state.activeInteraction = {
            interactionId: null,
            element: null,
            unboundMethod: null,
        }
    }

    createRemoveInteractionControl() {
        const button = document.createElement("button");
        button.className = "bg-danger text-white"
        button.addEventListener("click", () => {
            if(this.state.activeInteraction.interactionId) {
                this.resetActiveInteraction()
            }
        })
        button.innerHTML = '<i class="fa fa-times"/>';
        const element = document.createElement("div");
        element.className =  "ol-control ol-remove-interaction-control ol-unselectable d-none";
        element.appendChild(button);
        return element;
    }

    createGeoPointStyle(label=null) {
        const vectorSource = new ol.source.Vector({});
        const geopointStyle = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 10,
                fill: new ol.style.Fill({color: '#C70039'}),
                stroke: new ol.style.Stroke({
                    color: 'white', width: 1
                })
            }),
            text: new ol.style.Text({
                text: label ?? "",
                font: 'bold 8px Calibri,sans-serif',
                fill: new ol.style.Fill({color: '#000'}),
                stroke: new ol.style.Stroke({color: '#fff', width: 2})
            })
        });
        return { vectorSource, geopointStyle }
    }

    createGeoPointsControl() {
        const button = document.createElement("button");
        button.addEventListener("click", () => {
            button.classList.add("bg-primary", "text-white")
            this.map.getViewport().style.cursor = "pointer";
            this.createTooltipInfo();
            const infoTooltipHandler = e => {
                this.infoTooltipOverlay.setPosition(e.coordinate)
                const [lon, lat] = e.coordinate;
                this.infoTooltipElement.innerHTML = `
                    <p> lon: ${lon} </p>
                    <p> lat: ${lat} </p>
                `
            }
            this.map.on("pointermove", infoTooltipHandler)
            const {  vectorSource, geopointStyle } = this.createGeoPointStyle()
            const vectorLayer = new ol.layer.Vector({
                source: vectorSource,
                style: feature => {
                    const label = String(feature.get("id"));
                    geopointStyle.getText().setText(label);
                    return [geopointStyle];
                }
            });
            this.map.addLayer(vectorLayer);
            const drawInteraction = new ol.interaction.Draw({
                source: vectorSource,
                type: 'Point',
                condition: e => this.mainLandCondition(e, "geopoint")
            });
            drawInteraction.id = this.uniqueID();
            this.map.addInteraction(drawInteraction);
            this.state.activeInteraction =  {
                interactionId: drawInteraction.id,
                element: button,
                unboundMethod: infoTooltipHandler
            }
            drawInteraction.on("drawend", async e => {
                this.map.removeInteraction(drawInteraction);
                this.resetInfoTooltip()
                this.map.un("pointermove", infoTooltipHandler)
                this.map.getViewport().style.cursor = "";
                button.classList.remove("bg-primary", "text-white")
                this.removeInteractionElement.classList.add("d-none")
                const [longitude, latitude] = e.feature.getGeometry().getCoordinates()
                try {
                    const record = await this.createGeoPoint({
                        longitude,
                        latitude,
                        land_id: this.props.record.data.id
                    }, vectorLayer)
                    if(!record) return;
                    const { id, name } = record.data
                    e.feature.set("id", id)
                    e.feature.set("coordinates", [longitude, latitude])
                    e.feature.set("name", name)
                    this.createCoordsTooltip()
                } catch (traceback) {
                    this.addDialog(ErrorDialog, { traceback });
                }
            })
        })
        button.innerHTML = '<i class="fa fa-map-marker"/>';
        const element = document.createElement("div");
        element.className = "ol-control ol-geopoints-control ol-unselectable";
        element.appendChild(button);
        return element;
    }

    createSearchControl() {
        const geocoder = new Geocoder('nominatim', {
            provider: 'osm',
            lang: 'es-ES',
            placeholder: 'Search for an address',
            limit: 5,
            autoComplete: true,
            keepOpen: false,
            featureStyle: new ol.style.Style({
                image: new ol.style.Icon({
                    src: 'base_geoengine/static/src/images/pin-icon.webp',
                    anchor: [0.5, 1],
                }),
            }),
        });
        geocoder.on('addresschosen', (e) => {
            const coords = e.coordinate;
            // [lon, lat]
            this.map.getView().animate({
                center: coords,
                zoom: 5,
            });
        });
        this.map.addControl(geocoder);
    }

    /**
     * Create the trash button that removes map features.
     * @returns the div in which the button is located.
     */
    createTrashControl() {
        const button = document.createElement("button");
        button.innerHTML = '<i class="fa fa-trash"/>';
        button.addEventListener("click", () => {
            this.deleteMode = true;
            button.classList.add("bg-primary", "text-white")
            this.valuesTooltipOverlay.setPosition(undefined);
            this.map.getViewport().style.cursor = "pointer";
            this.createTooltipInfo();
            const infoTooltipHandler = e => this.infoTooltipOverlay.setPosition(e.coordinate)
            const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
            this.infoTooltipElement.textContent = `Double ${isTouchDevice ? "tap" : "click"} on the land you want to remove`;
            this.map.on("pointermove", infoTooltipHandler)
            const { doubleClick, touchOnly } = ol.events.condition;
            const condition = isTouchDevice ? touchOnly : doubleClick;
            if(this.selectInteraction) this.map.removeInteraction(this.selectInteraction);
            this.selectInteraction = new ol.interaction.Select({condition});
            this.selectInteraction.id = this.uniqueID();
            // store the current interaction to remove it if the user clicks on another control
            this.state.activeInteraction =  {
                interactionId: this.selectInteraction.id,
                element: button,
                unboundMethod: infoTooltipHandler
            }
            this.map.addInteraction(this.selectInteraction);
            this.selectInteraction.on("select", e => {
                const selectedFeature = e.selected;
                const ft = selectedFeature[0];
                if(!ft) {
                    selectHanlder()
                    return;
                }
                const layer = this.selectInteraction.getLayer(ft);
                const source = layer.getSource();
                const featureId = ft.get("id")
                const coordinates = ft.get("coordinates")
                const title = this.env._t("Caution");
                if(!featureId) {
                    this.addDialog(ConfirmationDialog, {
                        title,
                        body: this.env._t(
                            "Removing the Property Boundary will also permanently delete all associated lands on the map. Do you want to proceed?"
                        ),
                        confirm: async  () => {
                            this.selectPolygonElement.remove();
                            this.valuesTooltipElement = null;
                            this.map.removeControl(this.polygonTypeControl);
                            this.map.removeOverlay(this.valuesTooltipOverlay);
                            this.source = source;
                            try {
                                await Promise.allSettled([
                                    this.removeRelatedRecords("child_ids",  this.props.record.resModel),
                                    this.removeRelatedRecords("geopoint_ids",  this.props.record.resModel)
                                ])
                            } catch(traceback) {
                                this.addDialog(ErrorDialog, { traceback });
                            }
                            const layers = this.map.getLayers().getArray();
                            layers.forEach(layer => {
                                const source = layer.getSource();
                                source.clear()
                            })
                            this.onUIChange(null);
                        },
                    });
                }  
                // only the childs features have an id
                if(featureId){
                    // only geo points have coordinates
                    if(!coordinates) {
                        this.addDialog(ConfirmationDialog, {
                            title,
                            body: this.env._t(
                                `Are you sure you want to remove the ${ft.get("landName")} land?`
                            ),
                            confirm: async () => {
                                source.removeFeature(ft);
                                await this.orm.unlink(
                                    "project.agriculture.land", 
                                    [featureId]
                                )
                            },
                        });
                    } else {
                        this.addDialog(ConfirmationDialog, {
                            title,
                            body: this.env._t(
                                "Are you sure you want to remove the geopoint?"
                            ),
                            confirm: async () => {
                                source.removeFeature(ft);
                                await this.orm.unlink(
                                    "project.agriculture.scout", 
                                    [featureId]
                                );
                                this.coordsTooltipOverlay.setPosition(undefined);
                            },
                        });
                    }

                }
                selectHanlder()
            })

            const selectHanlder = () => {
                this.removeInteractionElement.classList.add("d-none")
                this.map.removeInteraction(this.selectInteraction);
                button.classList.remove("bg-primary", "text-white")
                this.resetInfoTooltip()
                this.map.un("pointermove", infoTooltipHandler)
                this.map.getViewport().style.cursor = "";
                this.valuesTooltipOverlay.setPosition(this.mainLandCenter);
                this.deleteMode = false;
            }
        });
        const element = document.createElement("div");
        element.className = "ol-clear ol-unselectable ol-control action-button";
        element.appendChild(button);
        return element;
    }

    createPolygonTypeControl() {
        this.selectPolygonElement = document.createElement("select");
        this.selectPolygonElement.addEventListener("change", e => {
            const color = e.target.value;
            this.selectPolygonElement.style.backgroundColor = color;
            this.createPolygonDrawInteraction(e.target.value)
        })
        this.selectPolygonElement.className = `form-select form-select-lg ol-polygon-type-control`;
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "Land types";
        defaultOption.selected = true;
        defaultOption.disabled = true; 
        this.selectPolygonElement.appendChild(defaultOption);
        LAND_TYPES.forEach(type => {
            const option = document.createElement("option");
            option.textContent = type.name;
            option.value = type.color;
            option.id = type.name;
            option.style.backgroundColor = type.color;
            this.selectPolygonElement.appendChild(option);
        });
        return this.selectPolygonElement;
    }

    mainLandCondition(e, polygonType) {
        const coordinate = e.coordinate;
        const point = new ol.geom.Point(coordinate);
        const isInside = this.mainLand.intersectsExtent(point.getExtent());
        if (!isInside) {
            this.addDialog(WarningDialog, {
                title: this.env._t("Warning"),
                message: this.env._t(
                    `The ${polygonType} you are trying to draw is outside of the Property Boundary.`
                ),
            });
        }
        return isInside;
    }
    
    createPolygonDrawInteraction(landColor) {
        if(this.drawInteraction) this.map.removeInteraction(this.drawInteraction);
        const { name:polygonType } = LAND_TYPES.find(type => type.color === landColor);
        const vectorLayer = this.createVectorLayer(landColor);
        this.drawInteraction = new ol.interaction.Draw({
            type: this.geoType,
            source: this.source,
            condition: e => this.mainLandCondition(e, "land")
        });
        this.drawInteraction.id = this.uniqueID();
        this.map.addLayer(vectorLayer);
        this.map.addInteraction(this.drawInteraction);
        this.state.activeInteraction = {
            interactionId: this.drawInteraction.id,
            element: null,
            unboundMethod: null,
        }
        this.drawInteraction.on("drawstart", e => {
            this.createTooltipInfo();
            this.sketch = e.feature;
            this.tooltipCoord = e.coordinate;
            this.listener = this.sketch.getGeometry().on("change", e => {
                const geom = e.target;
                const length = ol.sphere.getLength(geom) / 1000;
                this.infoTooltipElement.textContent = `${length.toFixed(2)} km`;
                this.tooltipCoord = geom.getInteriorPoint().getCoordinates();
                this.infoTooltipOverlay.setPosition(this.tooltipCoord);
            })
        });
        this.drawInteraction.on("drawend", async e => {
            this.drawInteraction = null;
            const feature = e.feature;
            this.selectPolygonElement.selectedIndex = 0;
            this.selectPolygonElement.style.backgroundColor = "";
            this.resetInfoTooltip()
            try {
                const record = await this.createChildLand({
                    parent_id: this.props.record.data.id,
                    polygon_type: polygonType,
                    the_geom: this.format.writeGeometry(feature.getGeometry()),
                    city_id: this.props.record.data.city_id[0]
                }, feature, this.source)
                if(record) {
                    const { id, name } = record.data
                    feature.set("name", `${polygonType || ''} \n ${name || ''}`);
                    feature.set("landName", name)
                    feature.set("id", id)
                } 
            } catch(traceback) {
                this.addDialog( ErrorDialog, { traceback });
            } finally {
                this.resetActiveInteraction()
            }
        });
    }

    /**
     * Create the buttons that change the map layers.
     * @returns the div in which the buttons are located.
     */
    createLayersControl() {
        const layersContainer = document.createElement("div");
        layersContainer.classList.add("ol-layers-container");
        const elementLayers = document.createElement("div");
        elementLayers.classList.add("ol-layers-element");
        layersContainer.appendChild(elementLayers);
        this.layer_list.forEach(layer => {
            const layerName = layer.getProperties().layerName;
            const bgImage = layer.getProperties().image;
            const button = document.createElement("button");
            if (layerName === "satellite") button.classList.add("text-white");
            button.id = layerName;
            button.textContent = layerName;
            button.style.backgroundImage = `url(${bgImage})`;
            button.addEventListener("click", e => {
                this.layer_list.forEach(l => l.setVisible(l.getProperties().layerName === e.target.id));
            });
            elementLayers.appendChild(button);
        });

        return layersContainer;
    }

    /**
     * Displays the map in the div provided.
     */
    renderMap() {
        this.map = new ol.Map({
            target: this.id,
            layers: this.layer_list,
            view: new ol.View({
                center: [0, 0],
                zoom: 6,
            }),
        });
        this.map.addLayer(this.vectorLayer);
        const snap = new ol.interaction.Snap({source: this.source});
        this.map.addInteraction(snap);
        this.format = new ol.format.GeoJSON({
            internalProjection: this.map.getView().getProjection(),
            externalProjection: "EPSG:" + this.srid,
        });
        if (!this.props.readonly && this.props.record.data.city_id)  this.setupControls();
        if (this.mapBoxToken) {
            this.map.on('pointermove', (e) => {
                const feature = this.map.forEachFeatureAtPixel(e.pixel, f => f);
                const cursor = feature?.get("coordinates") ? 'pointer' : '';
                this.map.getViewport().style.cursor = cursor;
                if (feature && this.mainLand && !this.drawInteraction) {
                    this.valuesTooltipOverlay.setPosition(this.mainLandCenter);
                } else if (this.valuesTooltipOverlay) {
                    this.valuesTooltipOverlay.setPosition(undefined);
                }
            });
        }
        this.map.on('click', e => {
            let featureFound = false;
            this.map.forEachFeatureAtPixel(e.pixel, feature => {
                if (featureFound) return;
                if (this.coordsTooltipOverlay) {
                    const coordinates = feature.get('coordinates');
                    if (coordinates) {
                        this.coordsTooltipElement.innerHTML = `
                            <div class="ol-tooltip-values-title">
                                <h5>${feature.get("name")}</h5>
                            </div>
                            <div class="ol-tooltip-values-content">
                                <p>
                                    Longitude: 
                                    <span class="font-weight-bold">
                                        ${coordinates[0]}
                                    </span>
                                </p>
                                <p>
                                    Latitude: 
                                    <span class="font-weight-bold">
                                        ${coordinates[1]}
                                    </span>
                                </p>
                            </div>`;
                        this.coordsTooltipOverlay.setPosition(coordinates);
                        featureFound = true;
                    }
                }
            });
            if (!featureFound && this.coordsTooltipOverlay || this.deleteMode) {
                this.coordsTooltipOverlay.setPosition(undefined);
            }
        });
    }
    /**
     * Creates a new info tooltip
     */
    createTooltipInfo() {
        if (this.infoTooltipElement) {
            this.infoTooltipElement.parentNode.removeChild(this.infoTooltipElement);
        }
        this.infoTooltipElement = document.createElement('div');
        this.infoTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
        this.infoTooltipOverlay = new ol.Overlay({
            element: this.infoTooltipElement,
            offset: [15, 0],
            positioning: 'bottom-center',
            stopEvent: false,
            insertFirst: false,
        });
        this.map.addOverlay(this.infoTooltipOverlay);
    }
    /**
     * Resets the values of the measure tooltip element and the sketch, so that a new
     * tooltip can be created.
     * @returns {void}
     */
    resetInfoTooltip() {
        // unset sketch
        this.sketch = null;
        this.infoTooltipElement = null;
        this.map.removeOverlay(this.infoTooltipOverlay);
    }
    /**
    * Creates a new values tooltip
    */
    createValuesTooltip() {
        if (this.valuesTooltipElement) {
            this.valuesTooltipElement.parentNode.removeChild(this.valuesTooltipElement);
        }
        this.valuesTooltipElement = document.createElement('div');
        this.valuesTooltipElement.className = 'ol-tooltip-values-container';
        this.addValuesTooltipContent();
        this.valuesTooltipOverlay = new ol.Overlay({
            element: this.valuesTooltipElement,
            positioning: 'bottom-center',
            offset: [0, -15],
            stopEvent: false,
            insertFirst: false,
        });
        this.map.addOverlay(this.valuesTooltipOverlay);
    }

    /**
     * Creates a new coordinates tooltip
     * 
     */
    createCoordsTooltip() {
        this.coordsTooltipElement = document.createElement('div');
        this.coordsTooltipElement.className = 'ol-tooltip-values-container';
        this.coordsTooltipOverlay = new ol.Overlay({
            element: this.coordsTooltipElement,
            offset: [15, 0],
            positioning: 'bottom-center',
            stopEvent: false,
            insertFirst: false,
        });
        this.map.addOverlay(this.coordsTooltipOverlay);
    }

    /**
     * Displays the calculated values for the drawn feature in the measure tooltip.
     * @returns {void}
     */
    addValuesTooltipContent() {
        const { display_name, partner_id, area, longitude, latitude } = this.props.record.data
        const partnerName = partner_id?.[1] ?? 'No partner'
        const landName = display_name || 'No land name'
        this.valuesTooltipElement.innerHTML = `
            <div class="ol-tooltip-values-title">
                <p>${landName}</p>
            </div>
            <div class="ol-tooltip-values-content">
                <p>
                    Partner: ${partnerName}
                </p>
            </div>
        `
        const $toolTipContent = this.valuesTooltipElement.querySelector('.ol-tooltip-values-content')
        const values =  { area, longitude, latitude }
        for (const [unit, value] of Object.entries(values)) {
            const meassureUnit = document.createElement('p');
            const roundedValue = value.toFixed(2)
            meassureUnit.textContent = `${unit}: ${roundedValue}`;
            $toolTipContent.appendChild(meassureUnit);
        }
    }

    /**
     * Allow you to open the form view to create a new child land.
     * @param {*} landId
     */
    async createChildLand(values, feature, source) {
        const resModel = "project.agriculture.land"
        const {views} = await this.view.loadViews({
            resModel,
            views: [[false, "form"]]
        });
        const context = Object.fromEntries(
            Object.entries(values).map(([field, value]) => [`default_${field}`, value])
        );
        let record = null;
        return new Promise((resolve) => {
            this.addDialog(FormViewDialog, {
                resModel,
                title: this.env._t("New record"),
                viewId: views.form.id,
                context,
                onRecordSaved: r => {
                    record = r
                    resolve(r);  
                }
            },
            { onClose: () => {
                if (!record) {
                    source.removeFeature(feature);
                    resolve(); 
                }
            }});
        });
    }

    async createGeoPoint(values, vectorLayer) {
        const resModel = "project.agriculture.scout"
        const { views } = await this.view.loadViews({
            resModel,
            views: [[false, "form"]]
        });
        const context = Object.fromEntries(
            Object.entries(values).map(([field, value]) => [`default_${field}`, value])
        );
        let record = null;
        return new Promise((resolve) => {
            this.addDialog(FormViewDialog, {
                resModel,
                title: this.env._t("New record"),
                viewId: views.form.id,
                context ,
                onRecordSaved: r => {
                    record = r
                    resolve(r);  
                }
            },
            { onClose: () => {
                if (!record) {
                    this.map.removeLayer(vectorLayer);
                    resolve(); 
                }
            }});
        });
    }

    /**
     * Removes related records from a given attribute of a model.
     *
     * @param {string} attribute - The attribute from which related records should be removed.
     * @param {string} model - The model that contains the attribute.
     * @returns {Promise} A promise that resolves when the related records have been removed.
     */
    async removeRelatedRecords(attribute, model) {
        await this.orm.call(
            model,
            "remove_related_records",
            [this.props.record.data.id],
            {attribute}
        )
    }
}

FieldGeoEngineEditMap.template = "base_geoengine.FieldGeoEngineEditMap";
FieldGeoEngineEditMap.props = {
    ...standardFieldProps,
    opacity: {type: Number, optional: true},
    color: {type: String, optional: true},
};

FieldGeoEngineEditMap.extractProps = ({attrs}) => {
    return {
        opacity: attrs.options.opacity,
        color: attrs.options.color,
    };
};

export class FieldGeoEngineEditMapMultiPolygon extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "MultiPolygon";
        super.setup();
    }
}

export class FieldGeoEngineEditMapPolygon extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "Polygon";
        super.setup();
    }
}

export class FieldGeoEngineEditMapPoint extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "Point";
        super.setup();
    }
}

export class FieldGeoEngineEditMapMultiPoint extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "MultiPoint";
        super.setup();
    }
}

export class FieldGeoEngineEditMapLine extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "LineString";
        super.setup();
    }
}

export class FieldGeoEngineEditMapMultiLine extends FieldGeoEngineEditMap {
    setup() {
        this.geoType = "MultiLineString";
        super.setup();
    }
}

registry.category("fields").add("geo_multi_polygon", FieldGeoEngineEditMapMultiPolygon);
registry.category("fields").add("geo_polygon", FieldGeoEngineEditMapPolygon);
registry.category("fields").add("geo_point", FieldGeoEngineEditMapPoint);
registry.category("fields").add("geo_multi_point", FieldGeoEngineEditMapMultiPoint);
registry.category("fields").add("geo_line", FieldGeoEngineEditMapLine);
registry.category("fields").add("geo_multi_line", FieldGeoEngineEditMapMultiLine);
