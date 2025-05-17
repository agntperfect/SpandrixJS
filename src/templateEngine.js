class TemplateEngine {
    /**
     * Initializes the TemplateEngine.
     * @param {string} rootSelector - A CSS selector for the root element whose content will be templated.
     */
    constructor(rootSelector) {
        this.root = document.querySelector(rootSelector);
        if (!this.root) {
            throw new Error(`TemplateEngine: Element with selector "${rootSelector}" not found.`);
        }
        this.options = {
            missingValuePlaceholder: '', // Default placeholder for undefined/null values
        };
        this.components = {}; // For component registration: name -> definition
        this.filters = {};    // For filter registration: name -> function
        this._eventListeners = []; // To keep track of listeners for potential cleanup
        this.debug = false;
        this.globalData = {}; // Global data accessible by all components and root template
    }

    _logDebug(...args) {
        if (this.debug) {
            console.debug('[TemplateEngine DEBUG]', ...args);
        }
    }

    enableDebug() {
        this.debug = true;
        this._logDebug('Debug mode enabled.');
    }

    disableDebug() {
        this._logDebug('Debug mode disabled.');
        this.debug = false;
    }

    setGlobalData(globalObj) {
        if (typeof globalObj === 'object' && globalObj !== null) {
            this.globalData = globalObj;
            this._logDebug('Global data set to:', globalObj);
        } else {
            console.warn('TemplateEngine: setGlobalData expects a non-null object.');
        }
    }

    /**
     * Registers a component definition.
     * @param {string} name - The component's tag name (e.g., 'my-counter').
     * @param {Object} definition - Component definition.
     * @param {string} definition.template - HTML string for the component's template.
     * @param {Function} [definition.data] - Function that returns the component's initial data object.
     * @param {Object} [definition.methods] - Object containing methods for the component.
     * @param {Object} [definition.computed] - Object containing computed properties for the component.
     * @param {Function} [definition.created] - Lifecycle hook called when component instance is created.
     * @param {Function} [definition.mounted] - Lifecycle hook called when component is inserted into the DOM.
     * @param {Function} [definition.updated] - Lifecycle hook called when component is re-rendered due to data changes.
     */
    registerComponent(name, definition) {
        if (!name || !definition || !definition.template) {
            console.error("TemplateEngine: Invalid component definition for", name);
            return;
        }
        this.components[name.toLowerCase()] = definition;
        this._logDebug(`Registered component: <${name.toLowerCase()}>`);
    }

    /**
     * Registers a custom filter.
     * @param {string} name - The filter name.
     * @param {Function} filterFn - The filter function (value, ...args) => transformedValue.
     */
    registerFilter(name, filterFn) {
        if (typeof filterFn !== 'function') {
            console.error(`TemplateEngine: Filter "${name}" must be a function.`);
            return;
        }
        this.filters[name] = filterFn;
        this._logDebug(`Registered filter: "${name}"`);
    }

    /**
     * Fetches JSON data from a given URL.
     * @param {string} url - The URL to fetch JSON data from.
     * @returns {Promise<Object>} A promise that resolves with the parsed JSON data.
     */
    async loadJSON(url) {
        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .catch(error => {
                console.error(`TemplateEngine: Failed to load JSON from "${url}".`, error);
                throw error;
            });
    }

    /**
     * Retrieves a value from an object using a dot-separated path string.
     * @param {Object} obj - The object to retrieve the value from.
     * @param {string} path - The dot-separated path (e.g., "user.address.city", or "." for the object itself).
     * @returns {*} The value found at the path, or undefined if not found.
     * @private
     */
    _getValueByPath(obj, path) {
        if (path === '.') return obj;
        if (path === null || path === undefined || typeof path !== 'string' || path.trim() === '') {
            return undefined;
        }
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            if (result && typeof result === 'object' && key in result) {
                result = result[key];
            } else {
                return undefined;
            }
        }
        return result;
    }

    /**
     * Sets a value on an object using a dot-separated path string. Creates path if it doesn't exist.
     * @param {Object} obj - The object to set the value on.
     * @param {string} path - The dot-separated path (e.g., "user.address.city").
     * @param {*} value - The value to set.
     * @returns {boolean} True if setting was successful.
     * @private
     */
    _setValueByPath(obj, path, value) {
        if (typeof path !== 'string' || path.trim() === '') {
            this._logDebug('_setValueByPath: Invalid path provided.', path);
            return false;
        }
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                this._logDebug('_setValueByPath: Creating missing path segment:', key, 'in', current);
                current[key] = {};
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
        this._logDebug('_setValueByPath: Set', path, 'to', value, 'on', obj);
        return true;
    }


    /**
     * Sanitizes a string to be safely used as HTML content.
     * @param {string} str - The string to sanitize.
     * @returns {string} The sanitized string.
     * @private
     */
    _sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = String(str); // Ensures string conversion
        return temp.innerHTML;
    }

    /**
     * Parses a filter expression like "filterName:arg1:'literal':path.to.arg"
     * @param {string} filterCallStr - The string for a single filter call.
     * @param {Object} dataContext - Data context to resolve non-literal arguments.
     * @returns {{name: string, args: Array<any>}}
     * @private
     */
    _parseFilterCall(filterCallStr, dataContext) {
        const parts = filterCallStr.split(':').map(s => s.trim());
        const name = parts[0];
        const args = parts.slice(1).map(argStr => {
            if ((argStr.startsWith("'") && argStr.endsWith("'")) || (argStr.startsWith('"') && argStr.endsWith('"'))) {
                return argStr.slice(1, -1); // Literal string
            }
            if (!isNaN(parseFloat(argStr)) && isFinite(argStr)) {
                return parseFloat(argStr); // Literal number
            }
            if (argStr === 'true') return true;
            if (argStr === 'false') return false;
            return this._getValueByPath(dataContext, argStr); // Resolve from data context
        });
        return { name, args };
    }

    /**
     * Interpolates a template string with data, applying filters.
     * `{{key}}` will be HTML-sanitized.
     * `{{{key}}}` will be raw HTML.
     * Filters: `{{ key | filterA | filterB:arg1:"literal" }}`
     * @param {string} templateStr - The template string.
     * @param {Object} dataContext - The data object for interpolation.
     * @returns {string} The interpolated string.
     * @private
     */
    _interpolateString(templateStr, dataContext) {
        return String(templateStr).replace(/{{{([\s\S]*?)}}}|{{([\s\S]*?)}}/g, (match, rawKeyAndFilters, escapedKeyAndFilters) => {
            const isRaw = !!rawKeyAndFilters;
            let keyAndFilters = isRaw ? rawKeyAndFilters : escapedKeyAndFilters;
            keyAndFilters = keyAndFilters.trim();

            const parts = keyAndFilters.split('|').map(s => s.trim());
            const initialKey = parts[0];
            const filterCallsStr = parts.slice(1);

            let value = this._getValueByPath(dataContext, initialKey);
            this._logDebug(`Interpolating key "${initialKey}" in template string. Initial value:`, value);

            for (const filterCallStr of filterCallsStr) {
                const { name: filterName, args: filterArgs } = this._parseFilterCall(filterCallStr, dataContext);
                if (this.filters[filterName] && typeof this.filters[filterName] === 'function') {
                    try {
                        this._logDebug(`Applying filter "${filterName}" to value:`, value, 'with args:', filterArgs);
                        value = this.filters[filterName](value, ...filterArgs);
                        this._logDebug(`→ Result after "${filterName}":`, value);
                    } catch (e) {
                        console.error(`TemplateEngine: Error applying filter "${filterName}" to value from key "${initialKey}":`, e);
                    }
                } else {
                    console.warn(`TemplateEngine: Filter "${filterName}" not found.`);
                }
            }
            
            if (value === undefined || value === null) {
                this._logDebug(`→ Final value for "${initialKey}" is undefined/null, using placeholder.`);
                return this.options.missingValuePlaceholder;
            }

            return isRaw ? String(value) : this._sanitizeHTML(value);
        });
    }

    /**
     * Creates an event handler function based on an expression.
     * @param {Node} element - The element the event is attached to.
     * @param {string} handlerExpression - e.g., "doSomething" or "doSomething(item.id, 'foo', $event)"
     * @param {Object} dataContext - Primary data scope.
     * @param {Object} [methodsContext] - Optional context for methods (e.g., component methods). Defaults to dataContext.
     * @returns {Function|null} The event handler function or null if invalid.
     * @private
     */
    _createEventHandler(element, handlerExpression, dataContext, methodsContext) {
        const effectiveMethodsContext = methodsContext || dataContext;
        const match = handlerExpression.match(/^([\w$.]+)(?:\(([\s\S]*)\))?$/); // Allow $ in method names for e.g. $emit
        if (!match) {
            console.warn(`TemplateEngine: Invalid event handler expression: "${handlerExpression}"`, element);
            return null;
        }

        const handlerName = match[1];
        const argsString = match[2] || "";

        // Resolve handlerFn from the effectiveMethodsContext first, then dataContext as fallback (though usually they are linked for components)
        let handlerFn = this._getValueByPath(effectiveMethodsContext, handlerName);

        if (typeof handlerFn !== 'function') {
             // Fallback: check dataContext directly if methodsContext didn't have it (e.g. root-level methods)
            if (dataContext && typeof dataContext[handlerName] === 'function' && !methodsContext) {
                 handlerFn = dataContext[handlerName];
            } else {
                console.warn(`TemplateEngine: Handler function "${handlerName}" not found in context. Element:`, element, "Method Context:", effectiveMethodsContext, "Data Context:", dataContext);
                return null;
            }
        }
        this._logDebug(`Attaching event handler "${handlerExpression}" on`, element);
        return (event) => {
            const resolvedArgs = argsString.split(',')
                .map(arg => arg.trim())
                .filter(arg => arg)
                .map(argStr => {
                    if (argStr === '$event') return event;
                    if ((argStr.startsWith("'") && argStr.endsWith("'")) || (argStr.startsWith('"') && argStr.endsWith('"'))) {
                        return argStr.slice(1, -1);
                    }
                    if (!isNaN(parseFloat(argStr)) && isFinite(argStr)) {
                        return parseFloat(argStr);
                    }
                    if (argStr === 'true') return true;
                    if (argStr === 'false') return false;
                    const val = this._getValueByPath(dataContext, argStr); // Args resolved from dataContext (e.g., loop item)
                    if (val === undefined) {
                         console.warn(`TemplateEngine: Argument "${argStr}" in handler "${handlerExpression}" not found in dataContext. Passing undefined.`);
                    }
                    return val;
                });
            
            handlerFn.apply(effectiveMethodsContext, resolvedArgs); // 'this' in handler will be effectiveMethodsContext
        };
    }
    
    /**
     * Removes all tracked event listeners.
     * @private
     */
    _cleanupEventListeners() {
        this._logDebug('Cleaning up all global event listeners. Count:', this._eventListeners.length);
        this._eventListeners.forEach(({ element, type, handler }) => {
            element.removeEventListener(type, handler);
        });
        this._eventListeners = [];
    }

    /**
     * Removes tracked event listeners that are bound to elements within a given hostElement.
     * @param {Node} hostElement - The parent element whose listeners (and its children's listeners) should be cleaned.
     * @private
     */
    _cleanupEventListenersBoundWithin(hostElement) {
        if (!hostElement) return;
        let beforeCount = this._eventListeners.length;
        this._eventListeners = this._eventListeners.filter(({ element, type, handler }) => {
            if (hostElement === element || hostElement.contains(element)) {
                element.removeEventListener(type, handler);
                this._logDebug('Cleaned up event listener on', element, type, 'within', hostElement);
                return false; // Remove from tracked listeners
            }
            return true; // Keep in tracked listeners
        });
        this._logDebug(`Cleaned up ${beforeCount - this._eventListeners.length} listeners within`, hostElement);
    }


    /**
     * Recursively processes a DOM node, applying directives and interpolating content.
     * @param {Node} node - The DOM node to process.
     * @param {Object} dataContext - The current data context for this node.
     * @param {Object} [componentHostMethodsContext] - Methods context if processing inside a component, used for event handlers.
     * @private
     */
    _processNode(node, dataContext, componentHostMethodsContext = null) {
       // 0. Handle Registered Components (Element nodes only)
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            if (this.components[tagName]) {
                const componentDef = this.components[tagName];
                this._logDebug(`Processing component <${tagName}>. Host node:`, node);

                // 1. Capture slot content from the original custom element 'node' (BEFORE its children are manipulated)
                const slotContentFragment = document.createDocumentFragment();
                if (!node._slotContentCaptured) { // Capture only once if node is reused by parent's _processNode
                    while (node.firstChild) {
                        slotContentFragment.appendChild(node.firstChild); // Moves children
                    }
                    node._slotContentCaptured = true; 
                }


                // 2. Prepare component data, props, and methods context
                let componentInitialData = (typeof componentDef.data === 'function') ? componentDef.data.call({}) : {}; // Call data() with a neutral `this`
                const props = {};
                for (const attr of Array.from(node.attributes)) {
                    // Prop values from parent scope are dynamic, so interpolate them against PARENT's `dataContext`
                    // props[attr.name] = (attr.value.includes('{{') || attr.value.includes('{{{')))
                    //     ? this._interpolateString(attr.value, dataContext) // Interpolate in parent context
                    //     : attr.value;
                    props[attr.name] = (attr.value.includes('{{') || attr.value.includes('{{{')) ? this._interpolateString(attr.value, dataContext) : attr.value;
                }
                // Merge order: globalData < initial component data < props
                let componentInstanceData = { ...this.globalData, ...componentInitialData, ...props };

                let reactiveData; // To be assigned the Proxy

                // This will be the `this` context for methods, computed, and lifecycle hooks
                const methodsAndComputedContext = {}; 

                // 3. Reactivity & Re-render Function
                const rerenderComponent = () => {
                    this._logDebug(`Rerendering component <${tagName}>. Host node:`, node);
                    this._cleanupEventListenersBoundWithin(node); // Clean listeners for old content
                    node.innerHTML = ''; // Clear existing content of the component host 'node'

                    const tempRenderContainer = document.createElement('div');
                    // Interpolate template string with component's *own current* reactive data
                    tempRenderContainer.innerHTML = this._interpolateString(componentDef.template, reactiveData);

                    const newContentFragment = document.createDocumentFragment();
                    Array.from(tempRenderContainer.childNodes).forEach(child => {
                        const clonedChild = child.cloneNode(true); // Clone to avoid issues with processing nodes that are already in document fragment
                        if (clonedChild.nodeType === Node.ELEMENT_NODE && clonedChild.tagName.toLowerCase() === 'slot') {
                            newContentFragment.appendChild(slotContentFragment.cloneNode(true)); // Use captured slot content
                        } else {
                             // Recursively process child with component's reactiveData and its methodsAndComputedContext
                            this._processNode(clonedChild, reactiveData, methodsAndComputedContext);
                            newContentFragment.appendChild(clonedChild);
                        }
                    });
                    node.appendChild(newContentFragment);

                    if (componentDef.updated && reactiveData._mounted) {
                        componentDef.updated.call(methodsAndComputedContext);
                        this._logDebug(`Lifecycle: <${tagName}> updated() called`);
                    }
                };

                const reactiveHandler = {
                    set: (target, key, value, receiver) => {
                        const success = Reflect.set(target, key, value, receiver);
                        if (!String(key).startsWith('_') && key !== '$el') { // Avoid re-render for internal properties
                            this._logDebug(`Reactive change in <${tagName}>: ${String(key)} =`, value,'. Triggering re-render.');
                            rerenderComponent();
                        }
                        return success;
                    },
                    get: (target, key, receiver) => {
                        if (componentDef.computed && typeof componentDef.computed[key] === 'function') {
                            this._logDebug(`Accessing computed property "${String(key)}" in <${tagName}>`);
                            return componentDef.computed[key].call(methodsAndComputedContext); // `this` is methodsAndComputedContext
                        }
                        return Reflect.get(target, key, receiver);
                    }
                };
                reactiveData = new Proxy(componentInstanceData, reactiveHandler);

                // 4. Setup `this` context for methods/computed/lifecycle & add helpers ($emit, $update, $el)
                Object.setPrototypeOf(methodsAndComputedContext, reactiveData); // `this.someData` in methods will access `reactiveData`

                if (componentDef.methods) {
                    for (const methodName in componentDef.methods) {
                        methodsAndComputedContext[methodName] = componentDef.methods[methodName];
                    }
                }
                methodsAndComputedContext.$emit = (eventName, detail) => {
                    this._logDebug(`Component <${tagName}> emitting "${eventName}" on`, node, "with detail:", detail);
                    node.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
                };
                methodsAndComputedContext.$update = () => {
                    this._logDebug(`Component <${tagName}> $update() called explicitly.`);
                    rerenderComponent();
                };
                reactiveData.$el = node; // Component's host element on the reactive data (less common to use than this.$el)
                methodsAndComputedContext.$el = node; // More common: this.$el in methods

                // 5. Lifecycle: created
                if (componentDef.created) {
                    componentDef.created.call(methodsAndComputedContext);
                    this._logDebug(`Lifecycle: <${tagName}> created() called`);
                }

                // 6. Initial Render
                this._logDebug(`Initial render for component <${tagName}> into host:`, node);
                rerenderComponent(); // This populates 'node' (the original custom element tag)

                // 7. Lifecycle: mounted
                if (componentDef.mounted) {
                    Promise.resolve().then(() => { // Defer to ensure element is in main DOM
                        if (document.body.contains(node)) {
                            componentDef.mounted.call(methodsAndComputedContext);
                            reactiveData._mounted = true; // Mark as mounted AFTER hook
                            this._logDebug(`Lifecycle: <${tagName}> mounted() called`);
                        } else {
                             this._logDebug(`Lifecycle: <${tagName}> mounted() skipped, element no longer in DOM.`);
                        }
                    });
                }
                return; // Component processed, stop further _processNode on this custom element tag itself
            }
        }


        // 1. Handle `data-if` for conditional rendering (Element nodes only)
        if (node.nodeType === Node.ELEMENT_NODE) {
            const ifConditionKey = node.getAttribute('data-if');
            if (ifConditionKey) {
                let conditionValue = this._getValueByPath(dataContext, ifConditionKey);
                if (ifConditionKey.startsWith('!')) {
                    conditionValue = !this._getValueByPath(dataContext, ifConditionKey.substring(1));
                }
                
                if (!conditionValue) {
                    this._logDebug('data-if: condition false for key', ifConditionKey, '. Removing node:', node);
                    node.remove();
                    return; 
                } else {
                    this._logDebug('data-if: condition true for key', ifConditionKey, '. Keeping node:', node);
                    node.removeAttribute('data-if'); // Processed for this render
                }
            }
        }
        
        // Handle `data-show` for visibility toggling (Element nodes only)
        if (node.nodeType === Node.ELEMENT_NODE) {
            const showConditionKey = node.getAttribute('data-show');
            if (showConditionKey) {
                let conditionValue = this._getValueByPath(dataContext, showConditionKey);
                if (showConditionKey.startsWith('!')) {
                    conditionValue = !this._getValueByPath(dataContext, showConditionKey.substring(1));
                }
                node.style.display = conditionValue ? '' : 'none';
                this._logDebug('data-show: key', showConditionKey, 'is', conditionValue, '. Node display set to:', node.style.display, node);
                // Attribute remains for future re-evaluations if DOM patching is introduced.
                // With current full re-render from template, it's re-read from template anyway.
            }
        }


        // 2. Handle `data-repeat` for list rendering (Element nodes only)
        if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-repeat')) {
            const repeatExpr = node.getAttribute('data-repeat').trim();
            node.removeAttribute('data-repeat'); // Remove to avoid re-processing template element itself

            let itemVar = 'item';
            let indexVar = '$index'; // Default index variable name
            let arrayExpr = repeatExpr;

            const matchIn = repeatExpr.match(/^(\w+)\s+in\s+(.+)$/);
            const matchInWithIndex = repeatExpr.match(/^(\w+)\s*,\s*(\w+)\s+in\s+(.+)$/);

            if (matchInWithIndex) {
                itemVar = matchInWithIndex[1];
                indexVar = matchInWithIndex[2];
                arrayExpr = matchInWithIndex[3];
            } else if (matchIn) {
                itemVar = matchIn[1];
                arrayExpr = matchIn[2];
            }

            const items = this._getValueByPath(dataContext, arrayExpr);
            this._logDebug(`Processing data-repeat: "${repeatExpr}" → itemVar "${itemVar}", indexVar "${indexVar}", arrayPath "${arrayExpr}"`);

            if (!Array.isArray(items)) {
                console.warn(`TemplateEngine: Data for data-repeat on "${arrayExpr}" is not an array or not found. Removing template element.`, node, dataContext);
                node.remove();
                return;
            }

            const parent = node.parentNode;
            if (!parent) {
                console.warn(`TemplateEngine: data-repeat element has no parent. Cannot insert clones.`, node);
                node.remove(); // Cannot proceed
                return;
            }
            
            const templateElement = node.cloneNode(true); // This is the element to be repeated

            items.forEach((item, index) => {
                const clone = templateElement.cloneNode(true);
                const itemContext = Object.create(dataContext); // Inherit from parent scope
                itemContext[itemVar] = item;
                itemContext[indexVar] = index;

                this._processNode(clone, itemContext, componentHostMethodsContext); // Process with item-specific context
                parent.insertBefore(clone, node); // Insert the processed clone before the original template node
            });

            node.remove(); // Remove the original template node
            return; // Stop processing for this node, its job is to be a template
        }

        // 3. Process attributes, event handlers, special content directives, and data-model
        if (node.nodeType === Node.ELEMENT_NODE) {
            const attributes = Array.from(node.attributes); 
            for (const attr of attributes) {
                const attrName = attr.name;
                const attrValue = attr.value;

                if (attrName.startsWith('data-on:')) {
                    const eventType = attrName.substring('data-on:'.length);
                    // Use componentHostMethodsContext if available (inside component), else dataContext (root template)
                    const handlerOwner = componentHostMethodsContext || dataContext;
                    const handler = this._createEventHandler(node, attrValue, dataContext, handlerOwner);
                    if (handler) {
                        node.addEventListener(eventType, handler);
                        this._eventListeners.push({ element: node, type: eventType, handler });
                    }
                    node.removeAttribute(attrName); 
                }
                else if (attrName === 'data-model' && !componentHostMethodsContext) { // data-model for root data context
                     // For components, data-model should bind to component's data, handled by its own _processNode pass.
                     // This section handles data-model for the main applyData context.
                     // Note: data-model on component tags themselves is not standard; pass data via props.
                }
                else if (!attrName.startsWith('data-') && (attrValue.includes('{{') || attrValue.includes('{{{'))) {
                     const interpolatedValue = attrValue.replace(/{{{([\s\S]*?)}}}|{{([\s\S]*?)}}/g, (match, rawKey, escapedKey) => {
                        const keyAndFilters = rawKey ? rawKey.trim() : (escapedKey ? escapedKey.trim() : null);
                        if (keyAndFilters === null) return match;
                        
                        const parts = keyAndFilters.split('|').map(s => s.trim());
                        const initialKey = parts[0];
                        const filterCallsStr = parts.slice(1);
                        let value = this._getValueByPath(dataContext, initialKey);

                        for (const filterCallStr of filterCallsStr) {
                            const { name: filterName, args: filterArgs } = this._parseFilterCall(filterCallStr, dataContext);
                            if (this.filters[filterName] && typeof this.filters[filterName] === 'function') {
                                value = this.filters[filterName](value, ...filterArgs);
                            }
                        }
                        return (value === undefined || value === null) ? this.options.missingValuePlaceholder : String(value);
                    });
                     if (node.getAttribute(attrName) !== interpolatedValue) { // Avoid unnecessary re-set
                         node.setAttribute(attrName, interpolatedValue);
                    }
                }
            }

            // Handle data-model for two-way binding
            // This needs to be after other attribute processing to ensure dataContext is correct (e.g. within a data-repeat)
            const modelKey = node.getAttribute('data-model');
            if (modelKey) {
                let currentValue = this._getValueByPath(dataContext, modelKey);
                const elementTag = node.tagName.toLowerCase();
                const inputType = node.type ? node.type.toLowerCase() : null;

                if (elementTag === 'input') {
                    if (inputType === 'checkbox') node.checked = !!currentValue;
                    else if (inputType === 'radio') node.checked = (node.value === String(currentValue));
                    else node.value = (currentValue !== undefined && currentValue !== null) ? currentValue : '';
                } else if (elementTag === 'textarea') {
                    node.value = (currentValue !== undefined && currentValue !== null) ? currentValue : '';
                } else if (elementTag === 'select') {
                    node.value = (currentValue !== undefined && currentValue !== null) ? currentValue : '';
                    // For select multiple, this would need more complex handling.
                }
                this._logDebug('data-model: Initialized input', node, 'for key', modelKey, 'to value', currentValue);

                const eventName = (elementTag === 'select' || (elementTag === 'input' && (inputType === 'checkbox' || inputType === 'radio'))) ? 'change' : 'input';
                
                const modelUpdateHandler = (event) => {
                    let newValue;
                    const target = event.target;
                    if (elementTag === 'input') {
                        if (inputType === 'checkbox') newValue = target.checked;
                        else if (inputType === 'radio') {
                            if (target.checked) newValue = target.value; else return; // Only update if this radio becomes checked
                        }
                        else newValue = target.value;
                    } else if (elementTag === 'textarea') {
                        newValue = target.value;
                    } else if (elementTag === 'select') {
                        newValue = target.value;
                    }

                    this._logDebug(`data-model: User input on [${modelKey}]. Event: ${eventName}, New value:`, newValue, 'Target element:', target);
                    this._setValueByPath(dataContext, modelKey, newValue); // This should trigger proxy if dataContext is reactive
                    
                    // If dataContext is a component's reactive data, its proxy's `set` handler will trigger re-render.
                    // If dataContext is the root data object and not proxied itself, this won't auto-refresh other parts of the UI
                    // unless a full applyData is called or dataContext has an $update method.
                    // For components, dataContext *is* the reactive proxy.
                };
                node.addEventListener(eventName, modelUpdateHandler);
                this._eventListeners.push({ element: node, type: eventName, handler: modelUpdateHandler });
                node.removeAttribute('data-model'); // Processed
            }


            const textKeyRaw = node.getAttribute('data-text');
            if (textKeyRaw !== null) {
                const value = this._interpolateString(`{{${textKeyRaw}}}`, dataContext); 
                node.textContent = value;
                node.removeAttribute('data-text');
                return; // Content is fully set, no need to process children for this node
            }

            const htmlKeyRaw = node.getAttribute('data-html');
            if (htmlKeyRaw !== null) {
                 const value = this._interpolateString(`{{{${htmlKeyRaw}}}}`, dataContext);
                node.innerHTML = value; // Already uses raw interpolation
                node.removeAttribute('data-html');
                return; // Content is fully set
            }
        }

        // 4. Recursively process child nodes
        // Must use a static copy of childNodes as _processNode can modify the DOM (e.g. data-repeat removing the template node)
        const childNodes = Array.from(node.childNodes); 
        for (const child of childNodes) {
            // If child was removed by a previous iteration (e.g. data-repeat template node), check if it's still in DOM.
            if (!child.parentNode && node.contains(child)) { // child.parentNode might be null if child was just removed by data-repeat
                 // This check might be complex. Simpler: data-repeat and component returns stop further processing.
                 // If a child is processed and it removes itself (like data-if), the list 'childNodes' is static
                 // but the actual DOM link is gone. This is usually fine.
            }
            if (child.nodeType === Node.ELEMENT_NODE) {
                this._processNode(child, dataContext, componentHostMethodsContext); 
            } else if (child.nodeType === Node.TEXT_NODE) {
                if (child.nodeValue.includes('{{') || child.nodeValue.includes('{{{')) {
                    child.nodeValue = this._interpolateString(child.nodeValue, dataContext);
                }
            }
        }
    }

    /**
     * Applies the given data to the template rooted at `this.root`.
     * @param {Object} data - The data object to apply.
     */
    applyData(data) {
        if (!this.root || typeof data !== 'object' || data === null) {
            console.error("TemplateEngine: Root element not available or invalid data for applyData.", { root: this.root, data });
            return;
        }
        this._logDebug('Applying data to root:', data);
        this._cleanupEventListeners(); // Remove all old listeners before re-rendering the entire root

        // Clone the root's initial content to serve as the template for this render pass
        // This assumes this.root originally contains the master template.
        // If this.root's innerHTML was modified by previous renders, we need a way to get the "original" template.
        // For simplicity, let's assume this.root itself can be cleared and re-populated.
        // Or, we store the original root template content. Let's try the latter.
        if (!this._originalRootTemplate) {
            this._originalRootTemplate = this.root.innerHTML;
        }

        // Create a temporary container from the original template
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = this._originalRootTemplate;
        
        const rootContext = Object.assign({}, this.globalData, data); // Merge global data with provided data
        
        // Process the nodes within the temporary container
        // We need to process its children, not the container itself directly with _processNode
        // if we want to replace this.root.innerHTML.
        // Or, _processNode could be adapted to work on a DocumentFragment.
        // Let's process child by child of tempContainer and append to a new fragment.
        
        const processedFragment = document.createDocumentFragment();
        Array.from(tempContainer.childNodes).forEach(childNode => {
            const clonedChild = childNode.cloneNode(true); // Process clones to leave tempContainer's children intact for next time
            this._processNode(clonedChild, rootContext, null); // Root context, no specific component methods context
            processedFragment.appendChild(clonedChild);
        });

        this.root.innerHTML = ''; // Clear the actual root element
        this.root.appendChild(processedFragment); // Append newly processed content
        this._logDebug('Finished applying data to root.');
    }

    /**
     * Loads JSON data from a URL and then renders the template.
     * @param {string} url - The URL to fetch JSON data from.
     * @returns {Promise<void>} A promise that resolves when rendering is complete or rejects on error.
     */
    renderFrom(url) {
        return this.loadJSON(url)
            .then(data => {
                this.applyData(data);
            })
            .catch(err => {
                console.error("TemplateEngine: Failed to render from URL.", err);
                // Optionally, render an error message in the root element
                if(this.root) this.root.innerHTML = `<p style="color:red;">Error loading data from ${url}. See console for details.</p>`;
                throw err; // Re-throw so caller can also catch
            });
    }
}