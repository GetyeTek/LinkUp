/**
 * ComponentRegistry
 * Allows federated micro-frontends to register their UI components globally
 * so the Host shell can render them without importing them directly.
 */
const registry = {};

export const registerComponent = (name, component) => {
    registry[name] = component;
};

export const getComponent = (name) => {
    return registry[name] || null;
};