// attach to CommonJS, AMD, Node, or Window
// inspired by https://github.com/addyosmani/memoize.js/blob/master/memoize.js
(function (root, factory) {
  if (typeof define === 'function' && define.amd) { // eslint-disable-line no-undef
    // AMD. Register as an anonymous module.
    define([], factory); // eslint-disable-line no-undef
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.butterfly = factory();
  }
}(this, function () {

  'use strict';

  var formElementNodeNames = ['input', 'output', 'range', 'select', 'span', 'textarea'];
  var formElementSelectors = formElementNodeNames.reduce(function (selectors, nodeName) {
    return selectors.concat((nodeName + '[name]:not([name=""])'));
  }, []).join(',');

  function butterfly(app) {
    app.data = Object.assign({}, app.data || {}, app.computed || {}, app.methods || {});

    // if (app.data.$) throw TypeError('Found $ as data property (reserved namespace)');

    app.__bindings = {}; // for each path, stores an array of functions to be run when the path is set
    app.__computed = []; // array of paths that are bound to computed values

    createView(app);
    createViewModel(app);

    return app.data;
  }

  var buildBindingByTypeAndReturnNodeToMount = {}; // used by buildBinding below. Moved out of the function because it should only be initialized once

  buildBindingByTypeAndReturnNodeToMount.INPUT = function inputElements(app, node, scope) {
    if (node.getAttribute('name')) {
      if (!scope) scope = node.getAttribute('name');
      touchBinding(app, scope);
      var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
      saveBinding(app, scope, function (value) {
        if (node[attr] != value) node[attr] = value;
      });
      setEventListenersOnFormElements(app, node, scope, attr);
    }
  };

  ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
    buildBindingByTypeAndReturnNodeToMount[type] = function otherFormElements(app, node, scope) {
      if (node.getAttribute('name')) {
        if (!scope) scope = node.getAttribute('name');
        touchBinding(app, scope);
        saveBinding(app, scope, function (value) {
          if (node.value != value) node.value = value;
        });
        setEventListenersOnFormElements(app, node, scope);
      }
    };
  });

  // buildBindingByTypeAndReturnNodeToMount.LISTX = function list(app, node, scope) {
  //   var listParent = node.parentNode;
  //   var listContainer = document.createElement('div');
  //   listContainer.setAttribute('list', scope); // TODO remove when minified: convenience to identify in Dev tools

  //   if (node.getAttribute('name')) {
  //     var listItemContainerMaster = document.createDocumentFragment();
  //     Array.from(node.cloneNode(true).childNodes).forEach(listItemContainerMaster.appendChild.bind(listItemContainerMaster));

  //     touchBinding(app, node.getAttribute('name'));
  //     saveBinding(app, node.getAttribute('name'), function (value) {
  //       // console.log('SET LIST', app.target, scope, value)

  //       var oldLength = listContainer.children.length;
  //       var newLength = value.length;

  //       if (newLength - oldLength < 0) {
  //         // console.log('REMOVE FROM LIST', newLength - oldLength);
  //         Array.from(listContainer.children).forEach(function (listItemNode, index) {
  //           if (index < newLength) populateAllBindings(app, `${scope}.${index}`);
  //           else listContainer.removeChild(listItemNode);
  //         });

  //       } else if (newLength - oldLength > 0) {
  //         // console.log('ADD TO LIST', oldLength, newLength - oldLength);
  //         var newListItemsContainer = document.createDocumentFragment();

  //         var listItemContainer;

  //         for (var pointer = oldLength; pointer < newLength; pointer++) {
  //           listItemContainer = listItemContainerMaster.cloneNode(true);
  //           Array.from(listItemContainer.childNodes).forEach(function (node) { // TODO: this code works when the child nodes dont contain mustaches. When I swap all mustaches with <spans> or <values>, I can use this again.
  //             if (node.hasAttribute) node.setAttribute('name', ''.concat(pointer, node.hasAttribute('name') ? ('.' + node.getAttribute('name')) : ''));
  //           });
  //           newListItemsContainer.appendChild(listItemContainer);
  //         }
  //         // console.log('Array.from(newListItemsContainer.childNodes)', Array.from(newListItemsContainer.childNodes));
  //         // bindViewToViewModel(app, Array.from(newListItemsContainer.childNodes), `${scope}`); // TODO replace with algorithm based on querySelectorAll, and diff with parent's work
  //         populateAllBindings(app, `${scope}.`);
  //         listContainer.appendChild(newListItemsContainer);
  //       }
  //     });
  //   }
  //   listParent.replaceChild(listContainer, node);
  //   return listContainer;
  // }

  buildBindingByTypeAndReturnNodeToMount.SPAN = function span(app, node, scope) {
    if (node.getAttribute('name')) {
      if (!scope) scope = node.getAttribute('name');
      touchBinding(app, scope);
      saveBinding(app, scope, function (value) {
        if (node.innerHTML != value) node.innerHTML = value;
      });
      node.innerHTML = '';
    }
  };



  function selectFormElements(rootNode) {
    return rootNode.querySelectorAll(formElementSelectors);
  }

  function buildBindings([app, rootNode]) {
    var leafNodeList = selectFormElements(rootNode);
    if (leafNodeList) {
      for (var leafNode of leafNodeList) {
        if (isSafePath(leafNode.getAttribute('name')) && buildBindingByTypeAndReturnNodeToMount[leafNode.nodeName]) buildBindingByTypeAndReturnNodeToMount[leafNode.nodeName](app, leafNode);
      }
    }
    return [app, rootNode];
  }

  /**
   * Return a Node containing the app DOM
   * @param {Object} app
   */
  function buildRootNode(app) {
    if (app.template) return [app, stringToDOMDocument((app.template[0] === '#') ? document.querySelector(app.template).innerHTML : app.template)];
    else return [app, document.getElementById(app.target.slice(1))];
  }

  function createView(app) {
    pipe(
      buildRootNode,
      replaceMustachesWithSpans,
      buildBindings,
      populateAllBindings,
      mountRootNode,
      function ([app, rootNode]) {
        if (app.mounted) app.mounted.call(app.data); // lifecycle hook
      }
    )(app);
  }

  function createViewModel(app) {
    app.data = new proxyfull(Object.assign({}, app.data), {
      set: function (target, property, value, receiver, path) {
        var result = patchViewOnModelChange(app).apply(this, arguments);
        if (app.updated) app.updated.call(app.data, path, value);
        return result;
      }
    });

    if (app.created) app.created.call(app.data);
  }

  function getPathValue(source, path) {
    return path
      .split('.')
      .reduce(function (initial, key) {
        if (typeof initial === 'undefined') return undefined;
        else return initial[key];
      }, source);
  }

  function isSafePath(path) {
    return (path.slice(0, 11) !== 'constructor' && path.indexOf('.constructor') === -1); // check for XSS attack by trying to access constructors
  }

  function JSONPath(basePath, property) {
    return (basePath + ((property) ? ('.' + property) : ''))
      .match(/[^\.].*/)[0];
  }

  function mountRootNode([app, rootNode]) {
    if (rootNode.id === app.target.slice(1)) return [app, rootNode];

    var target = document.getElementById(app.target.slice(1));
    removeAllNodeChildren(target);
    var fragment = document.createDocumentFragment();
    Array.from(rootNode.childNodes).forEach(fragment.appendChild.bind(fragment));

    target.appendChild(fragment);
    return [app, target];
  }

  function removeAllNodeChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function runWatcher(app, path, newValue) {
    var watcher = getPathValue(app.watch, path);
    if (typeof watcher === 'function') watcher.call(app.data, newValue, getPathValue(app.data, path)); // TODO proxy the context to detect infinite loop conditions
  }

  function patchViewOnModelChange(...args) {
    const app = args[0];
    if (args.length === 1) return _patch;
    return _patch(...(args.slice(1)));

    function _patch(target, property, value, receiver, path, bulk) {

      if (!bulk) runWatcher(app, path, value);

      // get computed value
      if (typeof value === 'function') value = value.call(app.data);

      // only update if something actually wants the value
      if (app.__bindings[path]) {
        app.__bindings[path].forEach(function (binder) {
          binder(value);
        });
      }

      // update computed values
      if (!bulk && app.__computed) app.__computed.forEach(function (path) {
        // run watchers
        var value = (getPathValue(app.data, path) || function () {}).call(Object.assign({}, app.data));
        runWatcher(app, path, value); // TODO : why am I running the watched?

        // apply bindings
        app.__bindings[path].forEach(function (binder) {
          binder(value);
        });
      });

      return true; // required for the Proxy `handler.set` trap
    };
  }

  function pipe(...funcs) {
    return function _pipe(...args) {
      return funcs.reduce((value, fn, index) => {
        const result = (index == 0) ? fn.apply(this, value) : fn.call(this, value);
        return result;
      }, args);
    };
  }

  function populateAllBindings([app, rootNode, filter = '']) {
    Object.keys(app.__bindings).forEach(function (path) {
      if (path.indexOf(filter) === 0) {
        var value = getPathValue(app.data, path);
        if (value) patchViewOnModelChange(app, null, null, value, null, path, true);
      }
    });
    return [app, rootNode];
  }

  function proxyfull(original, handler, logger, basePath, isArray = false) {

    // if (typeof original !== 'object') throw TypeError('Cannot create proxy with a non-object as target');
    // if (typeof handler !== 'object') throw TypeError('Cannot create proxy with a non-object as handler');

    if (typeof basePath === 'undefined') basePath = '';
    var _target = (isArray) ? original : Object.assign({}, original);

    Object.keys(_target).forEach(function (key) {
      if (typeof _target[key] === 'object') _target[key] = proxyfull(_target[key], handler, logger, basePath + '.' + key, Array.isArray(_target[key]));
    });

    const _handler = Object.assign({}, handler, {
      set: function (target, property, value, receiver) {

        // console.log('SET', target, property, value, receiver, JSONPath(basePath, property));

        if (typeof value === 'object') Reflect.set(target, property, proxyfull(value, handler, logger, JSONPath(basePath, property)));
        else Reflect.set(target, property, value);

        // Reflect.set(original, property, value);

        var path = (isArray) ? JSONPath(basePath) : JSONPath(basePath, property);
        if (handler.set && !(Array.isArray(target) && property == 'length')) return handler.set(target, property, (isArray) ? target : value, receiver, path);
        else return true;
      }
    });

    return new Proxy(_target, _handler);

  }

  function saveBinding(app, path, binder) {
    var value = getPathValue(app.data, path);
    if (typeof value === 'function' && app.__computed.indexOf(path) === -1) app.__computed.push(path);
    app.__bindings[path].push(binder);
  }

  function setEventListenersOnFormElements(app, node, scope, attribute = 'value') {
    var events = ['onclick', 'onchange', 'onkeypress', 'oninput'];
    var watcher = getPathValue(app.watch, node.getAttribute('name'));
    if ((node.hasAttribute('no-bind') === false) && (app.watch === true || watcher === true || node.hasAttribute('bind')))
      setEventListenersOnElement(node, function () {
        if (node[attribute] !== getPathValue(app.data, scope)) setPathValue(app.data, scope, node[attribute]);
      }, ...events);

    function setEventListenersOnElement(node, handler, ...events) {
      events.forEach(function (e) {
        node[e] = handler;
      });
    }
  }

  function setPathValue(source, path, value) { // inspired by: http://stackoverflow.com/posts/18937118/revisions
    var pointer = source;
    var keys = path.split('.');
    keys.slice(0, -1).forEach(function (key) {
      if (!pointer[key]) pointer[key] = {}
      pointer = pointer[key];
    });

    pointer[keys.slice(-1)] = value;
  }

  function stringToDOMDocument(stringHTML) {
    var doc = document.createElement('html');
    doc.innerHTML = stringHTML;
    return doc.childNodes[1]; // the body element
  }

  function replaceMustachesWithSpans([app, rootNode]) {
    rootNode.innerHTML = rootNode.innerHTML.replace(/{{(.+?)}}/g, function (match, path) {
      return `<span name="${path.trim()}"></span>`;
    });
    return [app, rootNode];
  }

  function touchBinding(app, path) {
    app.__bindings[path] = app.__bindings[path] || [];
  }

  return butterfly;
}));