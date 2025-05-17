# ⚡ SpandrixJS

*A lightweight, reactive DOM templating engine inspired by the metaphysical principle of Spanda — the primordial pulse that brings structure to form.*

> “Form arises from data. **SpandrixJS** binds them in rhythm.”

---

## 🌟 Features

* ✅ **Reactive Data Binding** – Automatically updates the DOM when data changes.
* ✅ **Component System** – Props, methods, computed, lifecycle hooks, and slot support.
* ✅ **Directive System** – Includes `data-if`, `data-show`, `data-repeat`, `data-model`, etc.
* ✅ **Filter Pipeline** – Chainable custom filters (`| uppercase | currency`).
* ✅ **Custom Events** – Emit and handle events between components.
* ✅ **Global Data Context** – Shared data across all templates.
* ✅ **Slot Support** – Native `<slot>` projection inside components.
* ✅ **Debug Mode** – Enable internal logging and lifecycle visibility.
* ✅ **Zero Dependencies** – Lightweight and framework-free.

---

## 🧠 Philosophy

> The name **Spandrix** comes from:
>
> * 📟 **Spanda** (Sanskrit): "Subtle pulse" — the first creative vibration of consciousness
> * 🧩 **Matrix**: A structure from which things manifest

SpandrixJS represents the metaphysical bridge between **awareness (data)** and **manifestation (DOM)**.

---

## Features

* **Interpolation:**
    * `{{ key }}`: Data-bound and HTML-sanitized content.
    * `{{{ key }}}`: Data-bound raw HTML content.
* **Filters:** Apply transformations to interpolated values (e.g., `{{ name | uppercase | truncate:10 }}`).
* **Directives:**
    * `data-if="conditionKey"` / `data-if="!conditionKey"`: Conditionally renders an element.
    * `data-show="conditionKey"` / `data-show="!conditionKey"`: Conditionally toggles CSS `display` of an element.
    * `data-repeat="item in itemsCollection"`: Renders an element for each item in an array.
        * Also supports `data-repeat="item, index in itemsCollection"`.
    * `data-on:<event_name>="handlerName"`: Attaches event listeners (e.g., `data-on:click="doSomething"`).
        * Handlers can accept arguments: `data-on:click="myFunc(item.id, 'literal', $event)"`.
        * `$event` provides access to the native event object.
    * `data-text="key"`: Sets the `textContent` of an element (supports filters via `{{key | filter}}` syntax within the attribute value internally).
    * `data-html="key"`: Sets the `innerHTML` of an element (supports filters, uses raw interpolation).
    * `data-model="data.path"`: Provides two-way data binding for form inputs (`<input>`, `<select>`, `<textarea>`).
* **Attribute Binding:** Interpolate data directly into attributes (e.g., `<img src="{{imageUrl}}">`). Supports filters.
* **Component System:**
    * Register components with `engine.registerComponent(name, definition)`.
    * **Definition:**
        * `template`: HTML string for the component.
        * `data()`: A function returning the component's initial data object.
        * `methods`: An object containing methods available to the component's template and logic.
        * `computed`: An object containing functions that derive values from component data.
        * `props`: (Conceptual) Attributes passed to the component tag are available in its data context.
        * `created()`: Lifecycle hook called when the component instance is initialized.
        * `mounted()`: Lifecycle hook called after the component is rendered and inserted into the DOM.
        * `updated()`: Lifecycle hook called after the component re-renders due to data changes.
    * **Reactivity:** Changes to component data automatically trigger a re-render of that component.
    * **Slots:** Use `<slot></slot>` within a component's template to project content from the parent.
    * **`this.$emit('eventName', payload)`:** Components can emit custom events.
    * **`this.$update()`:** Manually trigger a re-render of the component.
    * **`this.$el`:** Access the component's host DOM element.
* **Global Data:** Set global data accessible by all templates and components via `engine.setGlobalData({...})`.
* **JSON Data Loading:** Render templates using data fetched from a URL with `engine.renderFrom(url)`.
* **Debugging:** Enable/disable verbose console logging with `engine.enableDebug()` and `engine.disableDebug()`.
---

## 🚀 Getting Started

### 1. Include the Engine

```html
<script src="src/templateEngine.js"></script>
```

### 2. Define HTML Structure

```html
<div id="app">
  <h1>{{ title | uppercase }}</h1>
  <p>{{ message }}</p>
</div>
```

### 3. Initialize and Apply Data

```js
const engine = new TemplateEngine('#app');
engine.enableDebug();
engine.applyData({
  title: "SpandrixJS",
  message: "Welcome to the pulse of rendering."
});
```

---

## 🔧 Example Component

```js
engine.registerComponent('my-greeting', {
  template: `
    <div>
      <p>Hello {{ name }}!</p>
      <slot></slot>
    </div>
  `,
  data: () => ({ name: "Guest" }),
  created() {
    console.log("Greeting created for", this.name);
  }
});
```

```html
<my-greeting>
  <p>Welcome to SpandrixJS!</p>
</my-greeting>
```

---

## 🧩 Directives

| Directive       | Description                                       |
| --------------- | ------------------------------------------------- |
| `{{ key }}`     | Interpolation with HTML sanitization              |
| `{{{ key }}}`   | Raw HTML output                                   |
| `data-if`       | Conditional rendering                             |
| `data-show`     | Toggle `display: none`                            |
| `data-repeat`   | Loop through arrays (supports `item, i in items`) |
| `data-on:event` | Bind event handlers with arguments                |
| `data-model`    | Two-way input binding                             |
| `data-text`     | Insert textContent                                |
| `data-html`     | Insert innerHTML                                  |

---

## 🔢 Filters

```js
engine.registerFilter('uppercase', val => String(val).toUpperCase());
engine.registerFilter('currency', (val, sym = '$') => sym + parseFloat(val).toFixed(2));
```

**Usage:**

```html
<p>Price: {{ amount | currency:'€' }}</p>
```

---

## API

### `new TemplateEngine(rootSelector)`
Creates a new template engine instance.
* `rootSelector` (String): CSS selector for the root DOM element.

### `engine.applyData(dataObject)`
Renders/re-renders the content of the root element using the provided data.
* `dataObject` (Object): Data to be used for rendering.

### `engine.renderFrom(url)`
Fetches JSON data from the given `url` and then calls `applyData`.
* `url` (String): URL to fetch JSON data from.
* Returns: `Promise<void>`

### `engine.registerFilter(name, filterFunction)`
Registers a custom filter.
* `name` (String): Name of the filter (used in templates like `{{ value | name }}`).
* `filterFunction` (Function): `(value, ...args) => transformedValue`.

### `engine.registerComponent(tagName, definitionObject)`
Registers a component.
* `tagName` (String): Custom HTML tag name for the component (e.g., `my-custom-component`).
* `definitionObject` (Object): Component definition (see "Component System" above).

### `engine.setGlobalData(globalDataObject)`
Sets an object of global data that will be merged into the root data context and each component's data context (local data and props take precedence).
* `globalDataObject` (Object): Data to be made globally available.

### `engine.enableDebug()` / `engine.disableDebug()`
Toggles debug logging in the console.


---

## Installation / Usage

1.  **Include the script:**
    ```html
    <script src="templateEngine.js"></script>
    ```

2.  **HTML Structure:**
    Create a root element in your HTML where the template will be rendered.
    ```html
    <div id="app">
        <h1>{{ pageTitle }}</h1>
        <p>{{ message }}</p>
        <my-custom-component data-prop-name="{{ someData }}"></my-custom-component>
    </div>
    ```

3.  **Initialize the Engine:**
    ```javascript
    const engine = new TemplateEngine('#app'); // CSS selector for the root element
    ```

4.  **Apply Data:**
    ```javascript
    const myData = {
        pageTitle: "Welcome!",
        message: "This is rendered by the template engine.",
        someData: "Dynamic Prop Value"
    };
    engine.applyData(myData);
    ```


## Template Syntax Examples

**Basic Interpolation:**
```html
<p>Name: {{ user.name }}</p>
<div id="raw">{{{ user.rawHtmlContent }}}</div>
```
## 📎 Live Demo

> Coming soon: [https://agntperfect.github.io/spandrixJS/](https://agntperfect.github.io/spandrixJS/)

---

## 📜 License

**MIT License** — Use freely, contribute openly.

---

## 🙏 Acknowledgments

* Inspired by **Spanda**, the sacred pulse of creation
* Built with JavaScript. Driven by clarity, simplicity, and philosophy.

> Built with passion. Rendered with purpose.
