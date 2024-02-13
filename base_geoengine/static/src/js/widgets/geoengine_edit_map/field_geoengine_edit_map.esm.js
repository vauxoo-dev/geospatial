/** @odoo-module **/

/**
 * Copyright 2023 ACSONE SA/NV
 */


import { loadBundle } from "@web/core/assets";
import { _t } from "@web/core/l10n/translation";
import { session } from "@web/session";
import { registry } from "@web/core/registry";
import { useService, useOwnedDialogs } from "@web/core/utils/hooks";
import { WarningDialog, ErrorDialog } from "@web/core/errors/error_dialogs";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import {
    CUSTOM_LAYERS,
    LAND_TYPES,
    VIEW_TYPE_GEOENGINE,
    FEATURE_TYPES
} from "../../constants";
import { 
    isTouchDevice, 
    uniqueID, 
    generateGeoPoints, 
    createGeoPointStyle, 
    createLandStyle 
} from "../../helpers"
import { Component, onMounted, onRendered, onWillStart, useEffect, useState } from "@odoo/owl";


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
            currentInteraction: {
                interactionsId: [],
                element: null,
                unboundMethod: null,
                active: false,
            },
        })
        this.notification = useService("notification");

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
            this.props.value = this.props.record.data?.the_geom;
            this.isGeoengineView = this.getViewType()
            this.projection = result.projection;
            this.defaultExtent = result.default_extent;
            this.defaultZoom = result.default_zoom;
            this.restrictedExtent = result.restricted_extent;
            this.srid = result.srid;
            this.mapBoxToken = session.map_box_token || "";
            this.createLayers(this.props.record.data?.default_map_layer);
            this.renderMap();
            this.geoIp = await this.getGeoIp();
            this.setValue(this.props.value);
            this.geoPoints = this.props.record.data.geopoint_ids?.records ?? []
            if (this.geoPoints?.length > 0) this.createCoordsTooltip()
        });

        useEffect(
            () => {
                if (this.valuesTooltipElement) this.addValuesTooltipContent();
                if (!this.props.readonly && this.map && this.props.record.data.city_id) this.setupControls()
            },
            () => [this.props.record.data]
        )

        useEffect(
            () => {
                if (this.state.currentInteraction?.interactionsId.length > 0) {
                    this.removeInteractionElement.classList.remove("d-none")
                }
            },
            () => [this.state.currentInteraction]
        )

        // Is executed after component is rendered. When we use pagination.
        onRendered(() => {
            this.setValue(this.props.record.data?.the_geom);
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
        return ol.proj.transform(coords, 'EPSG:4326', 'EPSG:3857');
    }

    /**
     * Transforms the given extent from the 'EPSG:4326' projection to the 'EPSG:3857' projection.
     *
     * This function uses the OpenLayers `ol.proj.transformExtent` function to perform the transformation.
     *
     * @param {ol.Extent} extent - The extent to transform, expressed as an array of the form [minX, minY, maxX, maxY].
     * @returns {ol.Extent} The transformed extent, expressed in the 'EPSG:3857' projection.
     */
    transformExtent(extent) {
        return ol.proj.transformExtent(extent, 'EPSG:4326', 'EPSG:3857');
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
    createVectorLayer(color = "#0000f5") {
        this.features = new ol.Collection();
        this.source = new ol.source.Vector({ features: this.features });
        const landStyle = createLandStyle(color);
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
            CUSTOM_LAYERS.forEach(({ layerName, layerURL, image }) => {
                const layer = new ol.layer.Tile({
                    source: new ol.source.XYZ({
                        url: `${layerURL}${this.mapBoxToken}`,
                    }),
                    visible: false,
                    properties: { layerName, image }
                })
                this.layer_list.push(layer)
            })
            const defaultLayer = this.layer_list.find(layer => layer.getProperties().layerName === activeLayer)
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
                    map_view.fit(extent, { maxZoom: 25 });
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
            mapView.fit(extent, { maxZoom: this.defaultZoom || 15 });
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
            const ftGeometry = ft.getGeometry();
            if (ftGeometry) {
                this.mainLand = ftGeometry;
                const extent = this.mainLand.getExtent();
                this.mainLandCenter = ol.extent.getCenter(extent);
                ft.set("coordinates", this.mainLandCenter)
            }
            this.source.clear();
            this.source.addFeature(ft);
            if (value) {
                // if the value exists we create the values tooltip
                this.updateMapZoom();
                this.createValuesTooltip();
                if (this.props.record.data.city_id) await this.generateChildFeatures()
                if (this.geoPoints?.length > 0) generateGeoPoints(this.geoPoints, this.source);
            } else {
                this.updateMapEmpty();
            }
        }
    }

    /**
     * Asynchronously generates child land features on the map.
     *
     * This function retrieves child lands from the database using the `orm.call` method. 
     * For each child land, it creates a new OpenLayers feature with a geometry and label point read from the land's geometry.
     * It then finds the land type, creates a label, and sets a style for the feature based on the land type.
     * Finally, it sets the feature's ID, land name, and type, and adds the feature to the source.
     *
     * @returns {Promise<void>} A Promise that resolves when all child features have been generated and added to the source.
     */
    async generateChildFeatures() {
        const childLands = await this.orm.call(
            this.props.record.resModel,
            "get_child_lands",
            [this.props.record.data.id],
        )
        if (childLands.length <= 0) return;
        childLands.forEach(childLand => {
            const [id, name, polygonType, theGeometry] = childLand
            const ft = new ol.Feature({
                geometry: new ol.format.GeoJSON().readGeometry(theGeometry),
                labelPoint: new ol.format.GeoJSON().readGeometry(theGeometry),
            });
            const { color } = LAND_TYPES.find(landType => landType.name === polygonType)
            const label = `${polygonType} \n ${name}`
            const style = createLandStyle(color, label)
            ft.setStyle(style)
            ft.set("id", id)
            ft.set("landName", name)
            ft.set("type", FEATURE_TYPES.CHILD)
            this.source.addFeature(ft);
        })
    }

    /**
     * This is triggered when the view changed. When we have finished drawing our geo data, or
     * when we clear the map.
     * @param {*} geometry
     */
    async onUIChange(geometry) {
        const value = geometry ? this.format.writeGeometry(geometry) : null;
        await this.props.record.update({
            [this.props.name]: value,
        });
    }

    /**
     * Allow you to setup the trash button and the draw interaction.
     */
    setupControls() {
        if (!this.props.record.data?.the_geom && !this.drawInteraction) {
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
            const editLandControl = this.createEditLandControl()
            this.editLandControl = new ol.control.Control({ element: editLandControl });
            this.map.addControl(this.editLandControl);

            const childLandsControl = this.createChildLandsControl();
            this.childLandsControl = new ol.control.Control({ element: childLandsControl });
            this.map.addControl(this.childLandsControl);
        }

        if (!isTouchDevice()) {
            const fsElement = this.createFullscreenControl();
            this.fullscreenControl = new ol.control.Control({ element: fsElement });
            this.map.addControl(this.fullscreenControl);
        }

        const homeElement = this.createHomeControl();
        this.homeControl = new ol.control.Control({ element: homeElement });
        this.map.addControl(this.homeControl);

        const element = this.createTrashControl();
        this.clearmapControl = new ol.control.Control({ element: element });
        this.map.addControl(this.clearmapControl);

        const geopointsElement = this.createGeoPointsControl();
        this.geoPointsControl = new ol.control.Control({ element: geopointsElement });
        this.map.addControl(this.geoPointsControl);

        this.removeInteractionElement = this.createRemoveInteractionControl();
        this.removeInteractionControl = new ol.control.Control({ element: this.removeInteractionElement });
        this.map.addControl(this.removeInteractionControl);

        this.createSearchControl();

        if (!!this.mapBoxToken) {
            const elementLayers = this.createLayersControl();
            this.layersControl = new ol.control.Control({ element: elementLayers });
            this.map.addControl(this.layersControl);
        }
    }

    /**
     * Creates a fullscreen control for the map.
     *
     * This function creates a button that, when clicked, toggles fullscreen mode for the map. 
     * It checks if the fullscreen API is available in the standard or webkit-prefixed form, 
     * and uses the appropriate method to enter or exit fullscreen mode.
     * The created button is appended to a div, which is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a div containing the fullscreen button.
     */
    createFullscreenControl() {
        const button = document.createElement("button");
        button.innerHTML = '<i class="fa fa-expand"/>';
        button.addEventListener("click", () => {
            const mapContainer = this.map.getTargetElement();
            if (mapContainer.requestFullscreen) {
                document.fullscreenElement ? document.exitFullscreen() : mapContainer.requestFullscreen();
            }
            if (mapContainer.webkitRequestFullscreen) {
                document.fullscreenElement ? document.exitFullscreen() : mapContainer.webkitRequestFullscreen();
            }
        });
        const element = document.createElement("div");
        element.className = "ol-control ol-fs-control ol-unselectable";
        element.appendChild(button);
        return element;
    }

    /**
     * Creates a home control for the map.
     *
     * This function creates a button that, when clicked, animates the map view to center on the main land and zooms in to a level of 16. 
     * The created button is appended to a div, which is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a div containing the home button.
     */
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

    /**
    * Resets the active interaction on the map.
    * This method is used when the user clicks on the remove interaction button.
    * 
    * This method performs the following operations:
    * - Removes the interactions associated with the active interaction from the map.
    * - Removes the "bg-primary" and "text-white" classes from the element of the active interaction.
    * - Resets the info tooltip.
    * - Unbinds the method from the "pointermove" event of the map if it exists.
    * - Resets the cursor style of the map's viewport.
    * - Hides the remove interaction element.
    * - Resets the state of the active interaction.
    */
    resetActiveInteraction() {
        const { interactionsId, element, unboundMethod } = this.state.currentInteraction;
        interactionsId.forEach(interactionId => {
            const interaction = this.map.getInteractions().getArray().find(int => int.id === interactionId);
            if (interaction) this.map.removeInteraction(interaction);
        })
        if (element) element.classList.remove("bg-primary", "text-white")
        this.resetInfoTooltip();
        if (unboundMethod) this.map.un("pointermove", unboundMethod)
        this.map.getViewport().style.cursor = "";
        this.removeInteractionElement.classList.add("d-none")
        this.state.currentInteraction = {
            interactionsId: [],
            element: null,
            unboundMethod: null,
            active: false,
        }
    }

    /**
     * Creates a control for removing active interactions from the map.
     *
     * This function creates a button that, when clicked, checks if there are any active interactions. 
     * If there are, it calls the `resetActiveInteraction` method to remove them. 
     * The created button is appended to a div, which is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a div containing the remove interaction button.
     */
    createRemoveInteractionControl() {
        const button = document.createElement("button");
        button.className = "bg-danger text-white"
        button.addEventListener("click", () => {
            if (this.state.currentInteraction.interactionsId.length > 0) {
                this.resetActiveInteraction()
            }
        })
        button.innerHTML = '<i class="fa fa-times"/>';
        const element = document.createElement("div");
        element.className = "ol-control ol-remove-interaction-control ol-unselectable d-none";
        element.appendChild(button);
        return element;
    }


    /**
     * Creates a control for adding geopoint features to the map.
     *
     * This function creates a button that, when clicked, enables the user to add geopoints to the map. 
     * It changes the cursor to a pointer, creates an info tooltip that shows the longitude and latitude of the pointer, 
     * and sets up a handler for the "pointermove" event to update the tooltip position.
     * It then creates a new vector layer with a style for geopoints and adds it to the map.
     * It also creates a new draw interaction that allows the user to add geopoints to the vector layer, 
     * and sets up a handler for the "drawend" event to remove the interaction, reset the tooltip, 
     * and create a new geopoint in the database.
     * The created button is appended to a div, which is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a div containing the geopoints button.
     */
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
            const { vectorSource, geopointStyle } = createGeoPointStyle()
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
                condition: e => this.mainLandCondition(e, FEATURE_TYPES.GEOPOINT)
            });
            drawInteraction.id = uniqueID();
            this.map.addInteraction(drawInteraction);
            this.state.currentInteraction = {
                interactionsId: [drawInteraction.id],
                element: button,
                unboundMethod: infoTooltipHandler
            }
            drawInteraction.on("drawend", async e => {
                this.resetActiveInteraction()
                const [longitude, latitude] = e.feature.getGeometry().getCoordinates()
                try {
                    const removeLayer = () => this.map.removeLayer(vectorLayer);
                    const record = await this.createRecord({
                        longitude,
                        latitude,
                        land_id: this.props.record.data.id,
                    }, "project.agriculture.scout", removeLayer)
                    if (!record) return;
                    const { name } = record.data
                    const id = record.resId;
                    e.feature.set("id", id)
                    e.feature.set("coordinates", [longitude, latitude])
                    e.feature.set("landName", name)
                    e.feature.set("type", FEATURE_TYPES.GEOPOINT)
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
    /**
    * Creates a search control for the map.
    *
    * This function creates a new Geocoder control with the 'nominatim' type and 'osm' provider. 
    * The control has a placeholder text 'Search for an address', a limit of 5 results, and auto-completion enabled. 
    * It uses a custom style for the search results, with a pin icon as the marker.
    * When an address is chosen from the search results, the map view is animated to center on the chosen address and zoom in to a level of 5.
    * The created Geocoder control is then added to the map.
    */
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
        button.addEventListener("click", this.trashControlHandler.bind(this, button))
        const element = document.createElement("div");
        element.className = "ol-clear ol-unselectable ol-control action-button";
        element.appendChild(button);
        return element;
    }

    /**
     * Handles the trash control for removing features from the map.
     *
     * This function sets up a handler for the "pointermove" event to update the tooltip position, 
     * and a condition for the select interaction based on whether the device is a touch device.
     * It then creates a new select interaction with the condition, and adds it to the map.
     * The select interaction has a handler for the "select" event that removes the selected feature from the map and the database.
     * If the selected feature is a property boundary, it also removes all associated lands and geopoints from the map and the database.
     * If the selected feature is a land, it only removes the land from the map and the database.
     * If the selected feature is a geopoint, it only removes the geopoint from the map and the database.
     * After removing the feature, it resets the active interaction.
     *
     * @param {HTMLElement} button - The trash control button.
     */
    trashControlHandler(button) {
        this.state.activeMode = true;
        button.classList.add("bg-primary", "text-white")
        this.valuesTooltipOverlay.setPosition(undefined);
        this.map.getViewport().style.cursor = "pointer";
        this.createTooltipInfo();
        const infoTooltipHandler = e => this.infoTooltipOverlay.setPosition(e.coordinate)
        const touchDevice = isTouchDevice();
        this.infoTooltipElement.textContent = `Double ${isTouchDevice() ? "tap" : "click"} on the land you want to remove`;
        this.map.on("pointermove", infoTooltipHandler)
        const { doubleClick, touchOnly } = ol.events.condition;
        const condition = touchDevice ? touchOnly : doubleClick;
        if (this.selectInteraction) this.map.removeInteraction(this.selectInteraction);
        this.selectInteraction = new ol.interaction.Select({ condition });
        this.selectInteraction.id = uniqueID();
        // store the current interaction to remove it if the user clicks on another control
        this.state.currentInteraction = {
            interactionsId: [this.selectInteraction.id],
            element: button,
            unboundMethod: infoTooltipHandler,
            active: true,
        }
        this.map.addInteraction(this.selectInteraction);
        this.selectInteraction.on("select", e => {
            const ft = e.selected[0];
            if (!ft) {
                this.resetActiveInteraction()
                return;
            }
            const layer = this.selectInteraction.getLayer(ft);
            const source = layer.getSource();
            const featureId = ft.get("id")
            const coordinates = ft.get("coordinates")
            const title = _t("Caution");
            const successTitle = _t("Success");
            if (!featureId) {
                this.addDialog(ConfirmationDialog, {
                    title,
                    body: _t(
                        "Removing the Property Boundary will also permanently delete all associated lands on the map. Do you want to proceed?"
                    ),
                    confirm: async () => {
                        this.selectPolygonElement.remove();
                        this.valuesTooltipElement = null;
                        this.map.removeControl(this.childLandsControl);
                        this.map.removeOverlay(this.valuesTooltipOverlay);
                        this.source = source;
                        try {
                            await this.removeRelatedRecords("child_ids", this.props.record.resModel),
                                await this.removeRelatedRecords("geopoint_ids", this.props.record.resModel)
                            const layers = this.map.getLayers().getArray();
                            layers.forEach(layer => {
                                const source = layer.getSource();
                                source.clear()
                            })
                            this.onUIChange(null);
                            this.notify(successTitle, _t("Property Boundary removed successfully"), "success");
                        } catch (traceback) {
                            this.addDialog(ErrorDialog, { traceback });
                        }
                    },
                });
            }
            // only the childs features have an id
            else {
                // only geo points have coordinates
                if (!coordinates) {
                    this.addDialog(ConfirmationDialog, {
                        title,
                        body: _t(
                            `Are you sure you want to remove the ${ft.get("landName")} land?`
                        ),
                        confirm: async () => {
                            source.removeFeature(ft);
                            await this.orm.unlink(
                                "project.agriculture.land",
                                [featureId]
                            )
                            this.notify(successTitle, _t("Land removed successfully"), "success");
                        },
                    });
                } else {
                    this.addDialog(ConfirmationDialog, {
                        title,
                        body: _t(
                            "Are you sure you want to remove the geopoint?"
                        ),
                        confirm: async () => {
                            source.removeFeature(ft);
                            await this.orm.unlink(
                                "project.agriculture.scout",
                                [featureId]
                            );
                            this.coordsTooltipOverlay.setPosition(undefined);
                            this.notify(successTitle, _t("Geopoint removed successfully"), "success");
                        },
                    });
                }

            }
            this.resetActiveInteraction()
        })
    }

    /**
     * Creates a control for adding child lands to the map.
     *
     * This function creates a select element with options for each land type. 
     * Each option has a background color corresponding to the land type color, and a value corresponding to the land type color.
     * When an option is selected, it changes the background color of the select element to the selected color, 
     * and calls the `childLandsHandler` method with the selected color.
     * The select element is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a select element with options for each land type.
     */
    createChildLandsControl() {
        this.selectPolygonElement = document.createElement("select");
        this.selectPolygonElement.addEventListener("change", e => {
            const color = e.target.value;
            this.selectPolygonElement.style.backgroundColor = color;
            this.childLandsHandler(e.target.value)
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

    /**
     * Checks if a given coordinate is inside the main land.
     *
     * This function creates a new OpenLayers Point with the given coordinate, 
     * and checks if it intersects the extent of the main land.
     * If the point is not inside the main land, it shows a warning dialog with a message that the polygon being drawn is outside of the Property Boundary.
     *
     * @param {Object} event - The event object, which should have a 'coordinate' property.
     * @param {string} polygonType - The type of the polygon being drawn.
     * @returns {boolean} `true` if the coordinate is inside the main land, `false` otherwise.
     */
    mainLandCondition({ coordinate }, polygonType) {
        const point = new ol.geom.Point(coordinate);
        const isInside = this.mainLand.intersectsExtent(point.getExtent());
        if (!isInside) {
            this.addDialog(WarningDialog, {
                title: _t("Warning"),
                message: _t(
                    `The ${polygonType} you are trying to draw is outside of the Property Boundary.`
                ),
            });
        }
        return isInside;
    }

    /**
     * Creates a draw interaction for adding child lands to the map.
     *
     * This function first removes any existing draw interaction from the map. 
     * It then finds the land type that matches the given color, and creates a new vector layer with that color.
     * It creates a new OpenLayers Draw interaction with the 'land' condition, and adds it to the map.
     * The "drawstart" handler creates a tooltip that shows the length of the polygon being drawn, and updates the tooltip position as the polygon changes.
     * The "drawend" handler removes the draw interaction, resets the tooltip, and creates a new child land in the database with the drawn polygon's geometry.
     * If the creation is successful, it sets the feature's ID, land name, and type, and adds the feature to the source.
     * If an error occurs during the creation, it shows an error dialog with the traceback.
     * Finally, it resets the active interaction.
     *
     * @param {string} landColor - The color of the land type for the polygons.
     */
    childLandsHandler(landColor) {
        if (this.drawInteraction) this.map.removeInteraction(this.drawInteraction);
        const { name: polygonType } = LAND_TYPES.find(type => type.color === landColor);
        const vectorLayer = this.createVectorLayer(landColor);
        this.drawInteraction = new ol.interaction.Draw({
            type: this.geoType,
            source: this.source,
            condition: e => this.mainLandCondition(e, "land")
        });
        this.drawInteraction.id = uniqueID();
        this.map.addLayer(vectorLayer);
        this.map.addInteraction(this.drawInteraction);
        this.state.currentInteraction = {
            interactionsId: [this.drawInteraction.id],
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
                const removeFeature = () => this.source.removeFeature(feature);
                const record = await this.createRecord({
                    parent_id: this.props.record.data.id,
                    polygon_type: polygonType,
                    the_geom: this.format.writeGeometry(feature.getGeometry()),
                    city_id: this.props.record.data.city_id[0]
                }, "project.agriculture.land", removeFeature)
                if (record) {
                    const { id, name } = record.data
                    const label = `${polygonType || ''} \n ${name || ''}`
                    feature.set("name", label)
                    feature.set("landName", name)
                    feature.set("id", id)
                    feature.set("type", FEATURE_TYPES.CHILD)
                }
            } catch (traceback) {
                this.addDialog(ErrorDialog, { traceback });
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
     * Creates a control for editing lands on the map.
     *
     * This function creates a button with an edit icon. 
     * When the button is clicked, it calls the `editLandControlHandler` method with the button as the argument.
     * The created button is appended to a div, which is returned by the function.
     *
     * @returns {HTMLElement} The created control, which is a div containing the edit land button.
     */
    createEditLandControl() {
        const button = document.createElement("button");
        button.innerHTML = '<i class="fa fa-edit"/>';
        button.addEventListener("click", this.editLandControlHandler.bind(this, button));
        const element = document.createElement("div");
        element.className = "ol-control ol-edit-land-control ol-unselectable";
        element.appendChild(button);
        return element;
    }

    /**
     * Handles the edit land control for modifying features on the map.
     *
     * This function first removes any existing modify and select interactions from the map. 
     * It then creates a new select interaction and a new modify interaction with a condition that prevents new vertices from being added to the polygons.
     * The "modifystart" handler saves the old geometry of the feature being modified.
     * The "modifyend" handler checks if the new geometry is outside the main land. If it is, it shows a warning dialog and reverts the changes.
     * If the new geometry is inside the main land, it shows a confirmation dialog asking if the user wants to save the changes.
     * If the user confirms, it updates the feature in the database with the new geometry, and shows a success notification.
     * If an error occurs during the update, it shows an error dialog with the traceback.
     * Finally, it resets the active interaction.
     *
     * @param {HTMLElement} button - The edit land control button.
     */
    editLandControlHandler(button) {
        if (this.modifyInteraction) {
            this.map.removeInteraction(this.modifyInteraction);
            this.map.removeInteraction(this.selectInteraction);
        }
        button.classList.add("bg-primary", "text-white")
        this.selectInteraction = new ol.interaction.Select();
        this.modifyInteraction = new ol.interaction.Modify({
            features: this.selectInteraction.getFeatures(),
            insertVertexCondition: () => {
                // prevent new vertices to be added to the polygons
                return !this.selectInteraction
                    .getFeatures()
                    .getArray()
                    .every(ft => /Polygon/.test(ft.getGeometry().getType()));
            },
        });
        this.selectInteraction.id = uniqueID();
        this.modifyInteraction.id = uniqueID();
        this.state.currentInteraction = {
            interactionsId: [this.selectInteraction.id, this.modifyInteraction.id],
            element: button,
            unboundMethod: null,
            interactionType: this.modifyInteraction,
            active: true,
        }
        this.map.addInteraction(this.modifyInteraction);
        this.map.addInteraction(this.selectInteraction);
        let oldCoordinates;
        let oldGeometry;
        this.modifyInteraction.on('modifystart', (e) => {
            const feature = e.features.item(0);
            if (feature) {
                const featureGeometry = feature.getGeometry();
                if (feature.get("type") === FEATURE_TYPES.GEOPOINT) {
                    oldCoordinates = featureGeometry.getCoordinates();
                    return;
                }
                oldGeometry = featureGeometry.clone()
            }
        });
        this.modifyInteraction.on("modifyend", e => {
            const feature = e.features.item(0);
            if (!feature) return;
            const newFtGeometry = feature.getGeometry();
            const coordinates = feature.getGeometry().getCoordinates();
            const body = _t("Changes will be reverted");
            const cancelLabel = _t("Continue editing");
            const saveChangesLabel = _t("Save changes");
            const cautionTitle = _t("Caution");
            const successTitle = _t("Success");
            const saveChanges = _t("Would you like to save the changes you've made, or continue editing?");
            const changesSaved = _t("Changes saved successfully");
            const { type } = feature.getProperties();

            const isOutside = (coords) => {
                if (Array.isArray(coords[0])) {
                    return coords.flat(2).some(coord => !this.mainLand.intersectsCoordinate(coord));
                }
                return !this.mainLand.intersectsCoordinate(coords);
            }
            const onClose = () => {
                return type === FEATURE_TYPES.CHILD ?
                    feature.setGeometry(oldGeometry) :
                    feature.setGeometry(new ol.geom.Point(oldCoordinates))
            }
            const showDialog = (title, body) => this.addDialog(ConfirmationDialog, { title, body }, { onClose });
            const updateRecord = async (id, values) => {
                try {
                    await this.orm.write("project.agriculture.land", [id], values);
                } catch (traceback) {
                    this.addDialog(ErrorDialog, { traceback });
                }
            }
            // CASE: child land or geopoint
            // only child and geopoint have a type property
            if (type) {
                if (isOutside(coordinates)) {
                    const title = type === FEATURE_TYPES.CHILD ?
                        _t("All edges must be inside the Property Boundary") :
                        _t("Geopoint must be inside the Property Boundary");
                    showDialog(title, body);
                    return;
                }
                this.addDialog(ConfirmationDialog, {
                    confirmLabel: saveChangesLabel,
                    cancelLabel,
                    title: cautionTitle,
                    body: saveChanges,
                    confirm: async () => {
                        const { id, type } = feature.getProperties();
                        try {
                            switch (type) {
                                case FEATURE_TYPES.CHILD:
                                    const theGeom = this.format.writeGeometry(feature.getGeometry());
                                    await updateRecord(id, { the_geom: theGeom });
                                    break;
                                case FEATURE_TYPES.GEOPOINT:
                                    const [longitude, latitude] = feature.getGeometry().getCoordinates();
                                    await updateRecord(id, { longitude, latitude });
                                    break;
                            }
                        } catch (traceback) {
                            this.addDialog(ErrorDialog, { traceback });
                        }
                        this.notify(successTitle, changesSaved, "success")
                        this.resetActiveInteraction();
                    },
                    cancel: () => { }
                });
            }
            else {
                // property boundary
                const featureTypes = new Set(Object.values(FEATURE_TYPES));
                const filteredLayers = this.map.getLayers().getArray()
                    .filter(layer => layer.getSource() instanceof ol.source.Vector);
                let outsideFeatures = filteredLayers.flatMap(layer => {
                    const source = layer.getSource();
                    return source
                        .getFeatures()
                        .filter(ft => featureTypes.has(ft.get("type")) && isOutside(ft.getGeometry().getCoordinates()))
                        .map(ft => ({ ...ft.getProperties(), ft, source }))
                })
                if (outsideFeatures.length > 0) {
                    const getIds = () => outsideFeatures.map(({ id }) => id).join(", ")
                    this.addDialog(ConfirmationDialog, {
                        confirmLabel: _t("Remove features and save changes"),
                        cancelLabel,
                        title: _t("Some features are outside the Property Boundary"),
                        body: _t(`The following features will be removed: ${getIds()}`),
                        confirm: async () => {
                            const { childIds, geopointIds } = outsideFeatures.reduce((acc, { id, type }) => {
                                type === FEATURE_TYPES.CHILD ? acc.childIds.push(id) : acc.geopointIds.push(id);
                                return acc;
                            }, { childIds: [], geopointIds: [] });
                            const removeRecords = async (type, ids) => {
                                if (ids.length <= 0) return;
                                await this.removeRelatedRecords(type, this.props.record.resModel, ids)
                            }
                            const removeFtFromUI = () => outsideFeatures.forEach(({ source, ft }) => source.removeFeature(ft));
                            try {
                                removeFtFromUI();
                                await removeRecords("child_ids", childIds);
                                await removeRecords("geopoint_ids", geopointIds);
                                const theGeom = this.format.writeGeometry(feature.getGeometry());
                                await updateRecord(this.props.record.data.id, { the_geom: theGeom });
                                this.notify(
                                    successTitle,
                                    _t("Features removed and changes saved successfully"),
                                    "success"
                                )
                            } catch (traceback) {
                                this.addDialog(ErrorDialog, { traceback });
                            }
                            this.resetActiveInteraction();
                        },
                        cancel: () => outsideFeatures = []
                    })
                    return;
                }
                this.addDialog(ConfirmationDialog, {
                    confirmLabel: saveChangesLabel,
                    cancelLabel,
                    title: cautionTitle,
                    body: saveChanges,
                    confirm: () => {
                        this.onUIChange(newFtGeometry);
                        this.resetActiveInteraction();
                        this.notify(
                            successTitle,
                            changesSaved,
                            "success"
                        )
                    },
                    cancel: () => { }
                })
            }
        })
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
        const snap = new ol.interaction.Snap({ source: this.source });
        this.map.addInteraction(snap);
        this.format = new ol.format.GeoJSON({
            internalProjection: this.map.getView().getProjection(),
            externalProjection: "EPSG:" + this.srid,
        });
        if (!this.props.readonly && this.props.record.data.city_id) this.setupControls();
        if (this.mapBoxToken) {
            this.map.on('pointermove', (e) => {
                const feature = this.map.forEachFeatureAtPixel(e.pixel, f => f);
                const cursor = feature?.get("coordinates") ? 'pointer' : '';
                this.map.getViewport().style.cursor = cursor;
                if (feature && this.mainLand && !this.drawInteraction && !this.state.currentInteraction.active) {
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
                if (this.coordsTooltipOverlay && !this.state.currentInteraction.active) {
                    const coordinates = feature.get('coordinates');
                    const name = feature.get("landName")
                    if (coordinates && name ) {
                        this.coordsTooltipElement.innerHTML = `
                            <div class="ol-tooltip-values-title">
                                <h5>${ name }</h5>
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
                        return;
                    }
                    this.coordsTooltipOverlay.setPosition(undefined);
                }
            });
            if (!featureFound && this.coordsTooltipOverlay && !this.state.currentInteraction.active) {
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
    * Displays a notification with a given title, body, and type.
    *
    * This function uses the `notification.add` method to display a notification with the given parameters.
    * The notification type determines the color and icon of the notification.
    *
    * @param {string} title - The title of the notification.
    * @param {string} body - The body of the notification.
    * @param {boolean} sticky - Whether the notification should be sticky or not.
    * @param {string} type - The type of the notification. Can be 'info', 'warning', 'success', or 'danger'.
    */
    notify(title, body, type, sticky = false) {
        this.notification.add(body, { title, type, sticky })
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
        const values = { area, longitude, latitude }
        for (const [unit, value] of Object.entries(values)) {
            const meassureUnit = document.createElement('p');
            const roundedValue = value.toFixed(2)
            meassureUnit.textContent = `${unit}: ${roundedValue}`;
            $toolTipContent.appendChild(meassureUnit);
        }
    }

    /**
     * Opens the form view to create a new record.
     * @param {Object} values - The default field values for the new record.
     * @param {Object} featureOrLayer - The feature or layer to remove if the creation is cancelled.
     * @param {string} resModel - The model of the new record.
     * @param {Function} removeFunction - The function to call to remove the feature or layer if the creation is cancelled.
     * @returns {Promise} A promise that resolves with the created record.
     */
    async createRecord(values, resModel, removeFunction) {
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
                title: _t("New record"),
                viewId: views.form.id,
                context,
                onRecordSaved: r => {
                    record = r;
                    this.notify(
                        _t("Success"),
                        _t("Record created successfully"),
                        "success"
                    )
                    resolve(r);
                }
            },
                {
                    onClose: () => {
                        if (!record) {
                            removeFunction();
                            resolve();
                        }
                    }
                });
        });
    }

    /**
     * Removes related records from a given attribute of a model.
     *
     * @param {string} attribute - The attribute from which related records should be removed.
     * @param {string} model - The model that contains the attribute.
     * @returns {Promise} A promise that resolves when the related records have been removed.
     */
    async removeRelatedRecords(attribute, model, ids = []) {
        await this.orm.call(
            model,
            "remove_related_records",
            [this.props.record.data.id],
            { attribute, ids }
        )
    }
}

FieldGeoEngineEditMap.template = "base_geoengine.FieldGeoEngineEditMap";
FieldGeoEngineEditMap.props = {
    ...standardFieldProps,
    opacity: { type: Number, optional: true },
    color: { type: String, optional: true },
};

FieldGeoEngineEditMap.extractProps = ({ attrs }) => {
    return {
        opacity: attrs?.options?.opacity,
        color: attrs?.options?.color,
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

registry.category("fields").add("geo_multi_polygon", {
    component: FieldGeoEngineEditMapMultiPolygon
});
registry.category("fields").add("geo_polygon", {
    component: FieldGeoEngineEditMapPolygon
});
registry.category("fields").add("geo_point", {
    component: FieldGeoEngineEditMapPoint
});
registry.category("fields").add("geo_multi_point", {
    component: FieldGeoEngineEditMapMultiPoint
});
registry.category("fields").add("geo_line", {
    component: FieldGeoEngineEditMapLine
});
registry.category("fields").add("geo_multi_line", {
    component: FieldGeoEngineEditMapMultiLine
});
