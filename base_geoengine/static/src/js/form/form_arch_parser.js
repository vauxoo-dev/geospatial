/** @odoo-module */
import { FormArchParser } from "@web/views/form/form_arch_parser";
import { visitXML } from "@web/core/utils/xml";
import { Field } from "@web/views/fields/field";
import { addFieldDependencies } from "@web/model/relational_model/utils";


class FormArchParserGeoengine extends FormArchParser {

    /**
     * @param {Element} xmlDoc
     * @param {Object} models
     * @param {string} modelName
     * @returns {Object}
     * @override
    **/
    parse(xmlDoc, models, modelName) {
        const archParse = super.parse(xmlDoc, models, modelName);
        const jsClass = xmlDoc.getAttribute("js_class");
        const fieldNodes = {};
        const activeFields = {};
        visitXML(xmlDoc, node => {
            if (node.tagName === "field") {
                const fieldInfo = Field.parseFieldNode(node, models, modelName, "form", jsClass);
                addFieldDependencies(
                    activeFields,
                    models[modelName],
                );
                fieldNodes[fieldInfo.name] = fieldInfo;
                return false;
            }
        })
        for (const fieldNode of Object.values(fieldNodes)) {
            const fieldName = fieldNode.name;
            if (activeFields[fieldName]) {
                const { alwaysInvisible } = fieldNode;
                activeFields[fieldName] = {
                    ...fieldNode,
                    alwaysInvisible: activeFields[fieldName].alwaysInvisible && alwaysInvisible,
                };
            } else {
                activeFields[fieldName] = fieldNode;
            }
        }
        return {
            ...archParse,
            activeFields
        }
    }
}

export default FormArchParserGeoengine