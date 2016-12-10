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
    root.rudy = factory();
  }
}(this, function () {

  'use strict';

  function rudy(component) {

    if (component.data.$) throw TypeError('Found $ as data property (reserved namespace)');

    component.__bindings = {}; // for each path, stores an array of functions to be run when the path is set
    component.__computed = []; // array of paths with computed values

    createView(component);
    createViewModel(component);

    return component.data;
  }

  function buildBinding(component, node) {

    if (typeof node === 'undefined') return _buildBinding;
    else _buildBinding(node);

    function _buildBinding(node) {
      var typeTable = {};

      typeTable.INPUT = function inputElements(node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
          saveBinding(component, node.getAttribute('name'), function (value) {
            node[attr] = value;
          });
          setEventListenersOnFormElements(node, attr);
        }
      };

      ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
        typeTable[type] = function otherFormElements(node) {
          if (node.getAttribute('name')) {
            touchBinding(component, node.getAttribute('name'));
            saveBinding(component, node.getAttribute('name'), function (value) {
              node.value = value;
            });
            setEventListenersOnFormElements(node);
          }
        };
      });

      typeTable.VALUE = function inputElements(node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          saveBinding(component, node.getAttribute('name'), function (value) {
            node.innerHTML = value;
          });
          node.innerHTML = '';
        }
      };

      function setEventListenersOnFormElements(node, attribute = 'value') {
        var events = ['onclick', 'onchange', 'onkeypress', 'oninput'];
        var watch = getPathValue(component.watch, node.getAttribute('name'));
        if (node.hasAttribute('no-bind') === false) {
          if (component.watch === true || watch === true || (typeof watch !== 'function' && node.hasAttribute('bind'))) setEventListenersOnElement(node, function () {
            setPathValue(component.data, node.getAttribute('name'), node[attribute]);
          }, ...events);
          else if (typeof watch === 'function') {
            setEventListenersOnElement(node, function () {
              var value = watch(node[attribute], node);
              if (value) setPathValue(component.data, node.getAttribute('name'), value);
            }, ...events);
          }
        }

        function setEventListenersOnElement(node, handler, ...events) {
          events.forEach(function (e) {
            node[e] = handler;
          });
        }
      }

      if (typeof node.nodeName !== 'undefined' && typeTable[node.nodeName]) typeTable[node.nodeName](node);
      return node;
    }

  }

  function buildView(component, callback) {
    if (component.templateURL)
      getTemplateFromURL(component.templateURL,
        pipe(
          function (error, result) {
            if (error) throw Error('Could not download component template from ' + component.templateURL);
            if (result) return result;
          },
          stringToDOMDocument,
          callback
        )
      );
    else if (component.template)
      pipe(
        stringToDOMDocument,
        callback
      )(component.template);
    else pipe(
      Array.from,
      callback
    )(document.querySelector(component.target).childNodes);
  }

  function createView(component) {
    var dom;

    buildView(component,
      pipe(
        bindViewToViewModel,
        populateView,
        mountViewToTarget
      ));

    function bindViewToViewModel(doc) {
      doc.forEach(function (node) {
        traverseDOM(node, buildBinding(component));
      });
      dom = doc;
      return component;
    }

    function mountViewToTarget(component) {
      mountNodesToTarget(component, dom);
    }
  }

  function createViewModel(component) {
    component.__data = Object.assign({}, component.data);

    component.data = new proxyfull(component.__data, {
      set: patchViewOnModelChange(component)
    });

    if (typeof component.create === 'function') component.create.call(component.data);
  }

  function getTemplateFromURL(url, callback) {
    console.time('getTemplateFromURL');
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.onload = function () {
      console.timeEnd('getTemplateFromURL');
      if (request.readyState != 4 || request.status != 200) callback(true);
      else callback(null, request.responseText);
    };
    try {
      request.send();
    } catch (error) {
      callback(error);
    }
  }

  function getPathValue(source, path) {
    return path
      .split('.')
      .reduce(function (initial, key) {
        if (typeof initial === 'undefined') return undefined;
        else return initial[key];
      }, source);
  }

  function JSONPath(basePath, property) {
    return (basePath + '.' + property)
      .match(/[^\.].*/)[0];
  }

  function mountNodesToTarget(component, nodes) {
    var target = document.querySelector(component.target);
    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }
    var fragment = document.createDocumentFragment();
    nodes.forEach(fragment.appendChild.bind(fragment));
    target.appendChild(fragment);
  }

  function patchViewOnModelChange(...args) {
    const component = args[0];
    if (args.length === 1) return _patch;
    return _patch(...(args.slice(1)));

    function _patch(target, property, value, receiver, path) {

      // run watchers
      var watch = getPathValue(component.watch, path);
      if (typeof watch === 'function') value = watch(value, null) || value;

      // get live value
      if (typeof value === 'function') value = value.call(Object.assign({}, component.__data));

      // only update if something actually wants the value
      if (component.__bindings[path]) {
        component.__bindings[path].forEach(function (binder) {
          binder(value);
        });
      }

      // update live values
      if (component.__computed) component.__computed.forEach(function (path) {

        // run watchers
        var value = (getPathValue(component.__data, path) || function () {}).bind(Object.assign({}, component.__data));
        var watch = getPathValue(component.watch, path);
        if (typeof watch === 'function') value = watch(value, null) || value;

        // get live value if still a function
        if (typeof value === 'function') value = value.call(Object.assign({}, component.__data));

        // apply bindings
        component.__bindings[path].forEach(function (binder) {
          binder(value);
        });
      });

      return true; // required for the Proxy `handler.set` trap
    };
  }

  function pipe(...funcs) {
    return function (...args) {
      return funcs.reduce((value, fn, index) => {
        const result = (index == 0) ? fn.apply(this, value) : fn.call(this, value);
        return result;
      }, args);
    };
  }

  function saveBinding(component, path, binder) {
    var value = getPathValue(component.data, path);
    if (typeof value === 'function' && component.__computed.indexOf(path) === -1) component.__computed.push(path);
    component.__bindings[path].push(binder);
  }

  function setPathValue(source, path, value) { // credit: http://stackoverflow.com/posts/18937118/revisions
    var pointer = source;
    var keys = path.split('.');
    var length = keys.length;
    for (var index = 0; index < length - 1; index++) {
      var element = keys[index];
      if (!pointer[element]) pointer[element] = {}
      pointer = pointer[element];
    }

    pointer[keys[length - 1]] = value;
  }

  function stringToDOMDocument(str) {
    return Array.from((new DOMParser()).parseFromString(str, 'text/html').body.childNodes);
  }

  function populateView(component) {
    Object.keys(component.__bindings).forEach(function (path) {
      populateViewForModelPath(component, path, patchViewOnModelChange(component));
    });
    return component;
  }

  function populateViewForModelPath(component, path, patch) {
    var value = getPathValue(component.__data, path);
    if (value) patch(null, null, value, null, path);
  }

  function proxyfull(original, handler, logger, basePath) {

    if (typeof original !== 'object') throw TypeError('Cannot create proxy with a non-object as target');
    if (typeof handler !== 'object') throw TypeError('Cannot create proxy with a non-object as handler');

    if (typeof basePath === 'undefined') basePath = '';
    var _target = Object.assign({}, original);

    Object.keys(_target)
      .forEach(function (key) {
        if (typeof _target[key] === 'object' && !Array.isArray(_target[key])) {
          _target[key] = proxyfull(_target[key], handler, logger, basePath + '.' + key);
        }
      });

    const _handler = Object.assign({}, handler, {
      set: function (target, property, value, receiver) {

        if (typeof value === 'object' && !Array.isArray(value)) Reflect.set(target, property, proxyfull(value, handler, logger, JSONPath(basePath, property)));
        else Reflect.set(target, property, value);

        Reflect.set(original, property, value);

        if (handler.set) return handler.set(target, property, value, receiver, JSONPath(basePath, property));
        else return true;
      }
    });

    return new Proxy(_target, _handler);

  }

  function touchBinding(component, path) {
    component.__bindings[path] = component.__bindings[path] || [];
  }

  function traverseDOM(pointer, callback) { // inspiration: http://www.javascriptcookbook.com/article/Traversing-DOM-subtrees-with-a-recursive-walk-the-DOM-function/
    callback(pointer);

    pointer = pointer.firstChild;
    while (pointer) {
      traverseDOM(pointer, callback);
      pointer = pointer.nextSibling;
    }
  }

  return rudy;
}));