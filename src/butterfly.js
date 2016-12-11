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

  function butterfly(component) {
    component.data = Object.assign({}, component.data || {}, component.computed || {}, component.methods || {});

    // if (component.data.$) throw TypeError('Found $ as data property (reserved namespace)');

    component.__bindings = {}; // for each path, stores an array of functions to be run when the path is set
    component.__computed = []; // array of paths that are bound to computed values

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
            if (node[attr] != value) node[attr] = value;
          });
          setEventListenersOnFormElements(node, attr);
        }
      };

      ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
        typeTable[type] = function otherFormElements(node) {
          if (node.getAttribute('name')) {
            touchBinding(component, node.getAttribute('name'));
            saveBinding(component, node.getAttribute('name'), function (value) {
              if (node.value != value) node.value = value;
            });
            setEventListenersOnFormElements(node);
          }
        };
      });

      typeTable.VALUE = function inputElements(node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          saveBinding(component, node.getAttribute('name'), function (value) {
            if (node.innerHTML != value) node.innerHTML = value;
          });
          node.innerHTML = '';
        }
      };

      typeTable['#text'] = function textNodes(node) {
        var matches = node.textContent.match(/{{(.+?)}}/g);
        if (matches) {
          var path = matches[0].replace(/[{}]/g, '').trim();
          touchBinding(component, path);
          saveBinding(component, path, function (value) {
            node.nodeValue = value;
          });
          node.textContent = '';
        }
      };

      function setEventListenersOnFormElements(node, attribute = 'value') {
        var events = ['onclick', 'onchange', 'onkeypress', 'oninput'];
        var watcher = getPathValue(component.watch, node.getAttribute('name'));
        if ((node.hasAttribute('no-bind') === false) && (component.watch === true || watcher === true || node.hasAttribute('bind')))
          setEventListenersOnElement(node, function () {
            if (node[attribute] !== getPathValue(component.data, node.getAttribute('name'))) setPathValue(component.data, node.getAttribute('name'), node[attribute]);
          }, ...events);

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

  function buildView(component) {
    if (component.template) return stringToDOMDocument((component.template[0] === '#') ? document.querySelector(component.template).innerHTML : component.template);
    else return Array.from(document.getElementById(component.target.slice(1)).childNodes);
  }

  function createView(component) {
    var dom;
    pipe(
      buildView,
      bindViewToViewModel,
      populateView,
      mountViewToTarget
    )(component);

    function bindViewToViewModel(doc) {
      dom = doc.reduce(function (collection, node) {
        if (node.nodeName === '#text') return collection.concat(splitTextNodeByTemplates(node, buildBinding(component)));
        else return collection.concat(traverseDOM(node, buildBinding(component)));
      }, []);
      return component;
    }

    function mountViewToTarget(component) {
      mountNodesToTarget(component, dom);
      if (component.mounted) component.mounted.call(component.data);
    }
  }

  function createViewModel(component) {
    component.__data = Object.assign({}, component.data);

    component.data = new proxyfull(component.__data, {
      set: function (target, property, value, receiver, path) {
        var result = patchViewOnModelChange(component).apply(this, arguments);
        if (component.updated) component.updated.call(component.data, path, value);
        return result;
      }
    });

    if (component.created) component.created.call(component.data);
  }

  function getPathValue(source, path) {
    return path
      .split('.')
      .reduce(function (initial, key) {
        if (typeof initial === 'undefined') return undefined;
        else return initial[key];
      }, source);
  }

  function insertItemBetweenEachElementOfArray(targetArray, item) {
    return targetArray.reduce(function (result, element) {
      return result.concat(element, item);
    }, []).slice(0, -1);
  }

  function JSONPath(basePath, property) {
    return (basePath + '.' + property)
      .match(/[^\.].*/)[0];
  }

  function mountNodesToTarget(component, nodes) {
    var target = document.getElementById(component.target.slice(1));
    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }
    var fragment = document.createDocumentFragment();
    nodes.forEach(fragment.appendChild.bind(fragment));
    target.appendChild(fragment);
  }

  function runWatcher(component, path, newValue) {
    var watcher = getPathValue(component.watch, path);
    if (typeof watcher === 'function') watcher.call(component.data, newValue, getPathValue(component.__data, path)); // TODO proxy the context to detect infinite loop conditions
  }

  function patchViewOnModelChange(...args) {
    const component = args[0];
    if (args.length === 1) return _patch;
    return _patch(...(args.slice(1)));

    function _patch(target, property, value, receiver, path, bulk) {

      // console.log('PATCH', component.target, path, value, bulk);

      if (!bulk) runWatcher(component, path, value);

      // get computed value
      if (typeof value === 'function') value = value.call(component.data);

      // only update if something actually wants the value
      if (component.__bindings[path]) {
        component.__bindings[path].forEach(function (binder) {
          binder(value);
        });
      }

      // update computed values
      if (!bulk && component.__computed) component.__computed.forEach(function (path) {
        // run watchers
        var value = (getPathValue(component.__data, path) || function () {}).call(component.__data);
        runWatcher(component, path, value);

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

  function populateView(component) {
    Object.keys(component.__bindings).forEach(function (path) {
      var value = getPathValue(component.data, path);
      if (value) patchViewOnModelChange(component, null, null, value, null, path, true);
    });
    return component;
  }

  function proxyfull(original, handler, logger, basePath) {

    // if (typeof original !== 'object') throw TypeError('Cannot create proxy with a non-object as target');
    // if (typeof handler !== 'object') throw TypeError('Cannot create proxy with a non-object as handler');

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

  function saveBinding(component, path, binder) {
    var value = getPathValue(component.data, path);
    if (typeof value === 'function' && component.__computed.indexOf(path) === -1) component.__computed.push(path);
    component.__bindings[path].push(binder);
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

  function splitTextNodeByTemplates(node, callback) {
    var splitArray = splitTextNodeByTemplatesIntoArray(node);
    if (Array.isArray(splitArray)) {
      splitArray.forEach(
        pipe(
          callback,
          function (newNode) {
            node.parentNode.insertBefore(newNode, node);
          }
        )
      );
      node.parentNode.removeChild(node);
      return splitArray;
    } else {
      callback(node);
      return node;
    }
  }

  function splitTextNodeByTemplatesIntoArray(node) {

    var matches = node.textContent.match(/{{(.+?)}}/g);
    if (matches) return splitNodeTextContentByMatchesAndCreateTextNodes(node, matches);
    return node; // keep as is: does not have template strings

    function splitNodeTextContentByMatchesAndCreateTextNodes(node, matches) {

      var result = matches
        .reduce(
          function (arrayOfTextToSplitByAllMatches, match) {

            return arrayOfTextToSplitByAllMatches
              .reduce(
                function (arrayOfTextAlreadySplitByMatch, textToSplitByMatch) {
                  return (textToSplitByMatch === match) ? arrayOfTextAlreadySplitByMatch.concat(textToSplitByMatch) : arrayOfTextAlreadySplitByMatch.concat(insertItemBetweenEachElementOfArray(textToSplitByMatch.split(match), match));
                }, []
              );

          }, [node.textContent]
        )
        .map(
          function (textValueAfterSplittingByAllMatches) {
            return document.createTextNode(textValueAfterSplittingByAllMatches);
          }
        );
      return result;

    }

  }

  function stringToDOMDocument(str) {
    return Array.from((new DOMParser()).parseFromString(str, 'text/html').body.childNodes);
  }

  function touchBinding(component, path) {
    component.__bindings[path] = component.__bindings[path] || [];
  }

  function traverseDOM(pointer, callback) { // inspiration: http://www.javascriptcookbook.com/article/Traversing-DOM-subtrees-with-a-recursive-walk-the-DOM-function/
    callback(pointer);

    var child = pointer.firstChild;
    while (child) {
      if (child.nodeName === '#text') splitTextNodeByTemplates(child, callback);
      else traverseDOM(child, callback);
      child = child.nextSibling;
    }

    return pointer;
  }

  return butterfly;
}));