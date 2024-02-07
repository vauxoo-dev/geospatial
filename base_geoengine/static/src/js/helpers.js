/** @odoo-module **/

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
