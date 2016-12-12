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

  function bindViewToViewModel(component, view, baseScope = '') { // doc is Array of nodes
    return view.reduce(function (collection, node) {
      if (!node.getAttribute || !node.hasAttribute('name') || isSafePath(node.getAttribute('name'))) {
        var scope = (node.hasAttribute && node.hasAttribute('name') && node.getAttribute('name') !== '') ? JSONPath(baseScope, node.getAttribute('name')) : baseScope;
        if (node.nodeName === '#text') return collection.concat(splitTextNodeByTemplates(node, buildBinding(component), scope));
        else return collection.concat(traverseDOM(node, buildBinding(component), scope));
      }
      return collection;
    }, []);
  }

  var buildBindingByTypeAndReturnNodeToMount = {}; // used by buildBinding below. Moved out of the function because it should only be initialized once

  buildBindingByTypeAndReturnNodeToMount.INPUT = function inputElements(component, node, scope) {
    if (node.getAttribute('name')) {
      touchBinding(component, scope);
      var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
      saveBinding(component, scope, function (value) {
        if (node[attr] != value) node[attr] = value;
      });
      setEventListenersOnFormElements(component, node, scope, attr);
    }
  };

  ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
    buildBindingByTypeAndReturnNodeToMount[type] = function otherFormElements(component, node, scope) {
      if (node.getAttribute('name')) {
        touchBinding(component, scope);
        saveBinding(component, scope, function (value) {
          if (node.value != value) node.value = value;
        });
        setEventListenersOnFormElements(component, node, scope);
      }
    };
  });

  buildBindingByTypeAndReturnNodeToMount.LIST = function list(component, node, scope) {
    var listParent = node.parentNode;
    var listContainer = document.createElement('div');
    if (node.getAttribute('name')) {
      var listItemContainerMaster = document.createDocumentFragment();
      Array.from(node.cloneNode(true).childNodes).forEach(listItemContainerMaster.appendChild.bind(listItemContainerMaster));

      touchBinding(component, node.getAttribute('name'));
      saveBinding(component, node.getAttribute('name'), function (value) {
        // console.log('SET LIST', component.target, scope, value)

        var oldLength = listContainer.children.length;
        var newLength = value.length;
        var diffLength = newLength - oldLength;

        if (diffLength < 0) {
          // console.log('REMOVE FROM LIST', diffLength);
          Array.from(listContainer.children).forEach(function (listItemNode, index) {
            if (index < newLength) populateView(component, `${scope}.${index}`);
            else listContainer.removeChild(listItemNode);
          });

        } else if (diffLength > 0) {
          // console.log('ADD TO LIST', diffLength);
          var newListItemsContainer = document.createDocumentFragment();

          value.forEach(function (listValue, index) {
            if (index >= oldLength) {
              var listItemContainer = listItemContainerMaster.cloneNode(true);
              bindViewToViewModel(component, Array.from(listItemContainer.childNodes), `${scope}.${index}`);
              newListItemsContainer.appendChild(listItemContainer);
            } else populateView(component, `${scope}.${index}`);
          });
          populateView(component, `${scope}.`);
          listContainer.appendChild(newListItemsContainer);
        }
      });
    }
    listParent.replaceChild(listContainer, node);
    return listContainer;
  }

  buildBindingByTypeAndReturnNodeToMount.VALUE = function inputElements(component, node, scope) {
    if (node.getAttribute('name')) {
      touchBinding(component, scope);
      saveBinding(component, scope, function (value) {
        if (node.innerHTML != value) node.innerHTML = value;
      });
      node.innerHTML = '';
    }
  };

  buildBindingByTypeAndReturnNodeToMount['#text'] = function textNodes(component, node, scope) {
    var matches = node.textContent.match(/{{(.+?)}}/g);
    if (matches) {
      var path = matches[0].replace(/[{}]/g, '').trim();
      if (isSafePath(JSONPath(scope, path))) { // TODO move this earlier in the stack, before we build the bindings, or better yet right after we split the text nodes
        touchBinding(component, JSONPath(scope, path));
        saveBinding(component, JSONPath(scope, path), function (value) {
          node.nodeValue = value;
        });
        node.textContent = '';
      }
    }
  };

  function buildBinding(component, node, scope) {

    if (typeof node === 'undefined') return _buildBinding;
    else return _buildBinding(node, scope);

    function _buildBinding(node, scope, traversalCallback) {
      if (typeof node.nodeName !== 'undefined' && buildBindingByTypeAndReturnNodeToMount[node.nodeName]) {
        if (['LIST', '#text'].indexOf(node.nodeName) === -1) traversalCallback();
        return buildBindingByTypeAndReturnNodeToMount[node.nodeName](component, node, scope) || node;
      } else {
        traversalCallback();
        return node;
      }
    }
  }

  function buildView(component) {
    if (component.template) return stringToDOMDocument((component.template[0] === '#') ? document.querySelector(component.template).innerHTML : component.template);
    else return Array.from(document.getElementById(component.target.slice(1)).childNodes);
    // else return stringToDOMDocument(document.getElementById(component.target.slice(1)).innerHTML);
  }

  function createView(component) {
    pipe(
      buildView,
      function (view) {
        return [component, bindViewToViewModel(component, view)];
      },
      function ([component, view]) {
        populateView(component);
        return [component, view];
      },
      function ([component, view]) {
        mountViewToTarget(component, view);
        if (component.mounted) component.mounted.call(component.data); // lifecycle hook
      }
    )(component);
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

  function isSafePath(path) {
    return (path.slice(0, 11) !== 'constructor' && path.indexOf('.constructor') === -1); // check for XSS attack by trying to access constructors
  }

  function JSONPath(basePath, property) {
    return (basePath + ((property) ? ('.' + property) : ''))
      .match(/[^\.].*/)[0];
  }

  function mountViewToTarget(component, nodes) {
    var target = document.getElementById(component.target.slice(1));
    removeAllNodeChildren(target);
    var fragment = document.createDocumentFragment();
    nodes.forEach(fragment.appendChild.bind(fragment));
    target.appendChild(fragment);
  }

  function removeAllNodeChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
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

  function populateView(component, filter = '') {
    Object.keys(component.__bindings).forEach(function (path) {
      if (path.indexOf(filter) === 0) {
        var value = getPathValue(component.data, path);
        if (value) patchViewOnModelChange(component, null, null, value, null, path, true);
      }
    });
    return component;
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

  function saveBinding(component, path, binder) {
    var value = getPathValue(component.data, path);
    if (typeof value === 'function' && component.__computed.indexOf(path) === -1) component.__computed.push(path);
    component.__bindings[path].push(binder);
  }

  function setEventListenersOnFormElements(component, node, scope, attribute = 'value') {
    var events = ['onclick', 'onchange', 'onkeypress', 'oninput'];
    var watcher = getPathValue(component.watch, node.getAttribute('name'));
    if ((node.hasAttribute('no-bind') === false) && (component.watch === true || watcher === true || node.hasAttribute('bind')))
      setEventListenersOnElement(node, function () {
        if (node[attribute] !== getPathValue(component.data, scope)) setPathValue(component.data, scope, node[attribute]);
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

  function splitTextNodeByTemplates(node, callback, scope) {
    var splitArray = splitTextNodeByTemplatesIntoArray(node);
    if (Array.isArray(splitArray)) {
      splitArray.forEach(function (newNode) {
        // TODO check if each node is safe with isSafePath IF it is a match type string
        pipe(
          callback,
          function () {
            node.parentNode.insertBefore(newNode, node);
          }
        )(newNode, scope);
      });
      node.parentNode.removeChild(node);
      return splitArray;
    } else {
      callback(node, scope);
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
    var doc = document.createElement('html');
    doc.innerHTML = str;
    return Array.from(doc.childNodes[1].childNodes);
  }

  function touchBinding(component, path) {
    component.__bindings[path] = component.__bindings[path] || [];
  }

  function traverseDOM(pointer, callback, baseScope = '') { // inspiration: http://www.javascriptcookbook.com/article/Traversing-DOM-subtrees-with-a-recursive-walk-the-DOM-function/
    return callback(pointer, baseScope, function () {
      var child = pointer.firstChild;
      while (child) {
        if (!child.getAttribute || !child.hasAttribute('name') || isSafePath(child.getAttribute('name'))) {
          var scope = (child.hasAttribute && child.hasAttribute('name') && child.getAttribute('name') !== '') ? JSONPath(baseScope, child.getAttribute('name')) : baseScope;
          if (child.nodeName === '#text') splitTextNodeByTemplates(child, callback, scope);
          else traverseDOM(child, callback, scope);
        }
        child = child.nextSibling;
      }
    });
  }

  return butterfly;
}));