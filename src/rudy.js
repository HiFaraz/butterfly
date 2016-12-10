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

  var renderStart, renderDuration;

  function rudy(component) {
    component.__livePaths__ = [];
    mapBindings(component);
    createProxyData(component);
    return component;
  }

  function addBinder(component, path, binder) {
    var value = getProperty(component.data, path);
    if (typeof value === 'function' && component.__livePaths__.indexOf(path) === -1) component.__livePaths__.push(path);
    component.__bindings__[path].push(binder);
  }

  function buildDOM(component, callback) {
    if (component.templateURL)
      getTemplateFromURL(component.templateURL,
        pipe(
          function (error, result) {
            if (error) throw Error('Could not download component template from ' + component.templateURL);
            if (result) return result;
          },
          stringToDOMNodes,
          callback
        )
      );
    else if (component.template)
      pipe(
        stringToDOMNodes,
        callback
      )(component.template);
    else callback(document.querySelector(component.target).childNodes);
  }

  function createPatcher(component) {
    return function patch(target, property, value, receiver, path) {

      // run watchers
      var watcher = getProperty(component.watchers, path);
      if (typeof watcher === 'function') value = watcher(value, null) || value;

      // get live value
      if (typeof value === 'function') value = value.call(Object.assign({}, component.__data__));

      if (component.__bindings__[path]) {

        // apply bindings
        component.__bindings__[path].forEach(function (binder) {
          binder(value);
        });

        // update live values
        if (component.__livePaths__) component.__livePaths__.forEach(function (livePath) {

          // run watchers
          var liveValue = (getProperty(component.__data__, livePath) || function () {}).bind(Object.assign({}, component.__data__));
          var liveWatcher = getProperty(component.watchers, livePath);
          if (typeof liveWatcher === 'function') liveValue = liveWatcher(liveValue, null) || liveValue;

          // get live value if still a function
          if (typeof liveValue === 'function') liveValue = liveValue.call(Object.assign({}, component.__data__));

          // apply bindings
          component.__bindings__[livePath].forEach(function (binder) {
            binder(liveValue);
          });
        });
      }
      return true;
    };
  }

  function createProxyData(component) {
    component.__data__ = Object.assign({}, component.data);
    var __proxy__ = null;

    Object.defineProperty(component, 'data', {
      get: function () {
        return __proxy__;
      },
      set: function (value) {
        component.__data__ = Object.assign({}, value);
        __proxy__ = new proxyfull(component.__data__, {
          set: createPatcher(component)
        });
        if (typeof this.create === 'function') {
          this.__create__ = this.create;
          this.create.call(this.data);
          delete this.create;
        }
        syncAllPathsToView(this);
      },
    });

    component.data = component.__data__;

    return component;
  }

  function insertItemBetweenEachElementOfArray(targetArray, item) {
    var result = [];
    targetArray.forEach(function (element) {
      result.push(element, item);
    })
    result.pop();
    return result;
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

  function getProperty(source, path) {
    if (source && path) return path
      .split('.')
      .reduce(function (initial, key) {
        if (typeof initial === 'undefined') return undefined;
        else return initial[key];
      }, source);
    else return undefined;
  }

  function mapBindings(component) {

    component.__bindings__ = {};

    var dom = buildDOM(
      component,
      pipe(
        function (domResult) {
          domResult.forEach(function (node) {
            traverseNodeAndDo(node, buildBinding);
          });
          dom = domResult;
          return component;
        },
        syncAllPathsToView,
        publishDOM
      ));

    function buildBinding(node) {
      var typeTable = {};

      typeTable.INPUT = function inputElements(node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
          addBinder(component, node.getAttribute('name'), function (value) {
            node[attr] = value;
          });
          setEventListenersOnFormElements(node, attr);
        }
      };

      ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
        typeTable[type] = function otherFormElements(node) {
          if (node.getAttribute('name')) {
            touchBinding(component, node.getAttribute('name'));
            addBinder(component, node.getAttribute('name'), function (value) {
              node.value = value;
            });
            setEventListenersOnFormElements(node);
          }
        };
      });

      typeTable['#text'] = function textNodes(node) {
        var matches = node.textContent.match(/{{(.+?)}}/g);
        if (matches) {
          var path = matches[0].replace(/[{}]/g, '').trim();
          touchBinding(component, path);
          addBinder(component, path, function (value) {
            node.nodeValue = value;
          });
          node.textContent = '';
        }
      };

      function setEventListenersOnFormElements(node, attribute = 'value') {
        var events = ['onclick', 'onchange', 'onkeypress', 'oninput'];
        var watcher = getProperty(component.watchers, node.getAttribute('name'));
        if (node.hasAttribute('no-bind') === false) {
          if (component.watchers === true || watcher === true || (typeof watcher !== 'function' && node.hasAttribute('bind'))) setEventListenersOnElement(node, function () {
            set(component.data, node.getAttribute('name'), node[attribute]);
          }, ...events);
          else if (typeof watcher === 'function') {
            setEventListenersOnElement(node, function () {
              var value = watcher(node[attribute], node);
              if (value) set(component.data, node.getAttribute('name'), value);
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

    function updateValue(node) {
      var typeTable = {};

      typeTable.INPUT = function inputElements(node) {
        if (node.getAttribute('name')) {
          setNodeValue(component, node.getAttribute('name'), node, function (value) {
            node[((node.getAttribute('type') === 'checkbox') ? 'checked' : 'value')] = value;
          });
        }

      };

      ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function buildOtherFormElementBindings(type) {
        typeTable[type] = function otherFormElements(node) {
          setNodeValue(component, node.getAttribute('name'), node, function (value) {
            node.value = value;
          });
        };
      });

      typeTable['#text'] = function textNodes(node) {
        var matches = node.textContent.match(/{{(.+?)}}/g);
        if (matches) setNodeValue(component, matches[0].replace(/[{}]/g, '').trim(), node, function (value) {
          node.textContent = value;
        });
      };

      function setNodeValue(component, path, node, callback) {
        var value = getProperty(component.data, path);
        if (value) {
          if (typeof value === 'function') value = value.call(Object.assign({}, component.data));
          callback(value);
        }
      }

      if (typeof node.nodeName !== 'undefined' && typeTable[node.nodeName]) typeTable[node.nodeName](node);
      return node;
    }

    function publishDOM(component) {
      var target = document.querySelector(component.target);

      while (target.firstChild) {
        target.removeChild(target.firstChild);
      }

      dom.forEach(target.appendChild.bind(target))

      return true;
    }

  }

  function pipe(...funcs) {
    return function (...args) {
      return funcs.reduce((value, fn, index) => {
        const result = (index == 0) ? fn.apply(this, value) : fn.call(this, value);
        return result;
      }, args);
    };
  }

  function set(source, path, value) { // credit: http://stackoverflow.com/posts/18937118/revisions
    var schema = source; // a moving reference to internal objects within source
    var properties = path.split('.');
    var len = properties.length;
    for (var i = 0; i < len - 1; i++) {
      var element = properties[i];
      if (!schema[element]) schema[element] = {}
      schema = schema[element];
    }

    schema[properties[len - 1]] = value;
  }

  function splitTextNodeByTemplates(node) {

    var matches = node.textContent.match(/{{(.+?)}}/g);
    if (matches) {
      (function () {});
      return splitNodeTextContentByMatchesAndCreateTextNodes(node, matches);
    }
    return node; // keep as is: does not have template strings

    function splitNodeTextContentByMatchesAndCreateTextNodes(node, matches) {

      var result = matches
        .reduce(
          function (arrayOfTextToSplitByAllMatches, match) {

            return arrayOfTextToSplitByAllMatches
              .reduce(
                function (arrayOfTextAlreadySplitByMatch, textToSplitByMatch) {
                  return (textToSplitByMatch.indexOf(match) === -1 || textToSplitByMatch === match) ? arrayOfTextAlreadySplitByMatch.concat(textToSplitByMatch) : arrayOfTextAlreadySplitByMatch.concat(insertItemBetweenEachElementOfArray(textToSplitByMatch.split(match), match));
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

  function stringToDOMNodes(str) {
    return Array.from((new DOMParser()).parseFromString(str, 'text/html').body.childNodes);
  }

  function syncAllPathsToView(component) {
    var patch = createPatcher(component);
    Object.keys(component.__bindings__).forEach(function (path) {
      syncPathToView(component, path, patch);
    });
    return component;
  }

  function syncPathToView(component, path, patch) {
    if (typeof patch === 'undefined') patch = createPatcher(component);
    var value = getProperty(component.__data__, path);
    if (value) patch(null, null, value, null, path);
  }

  function touchBinding(component, path) {
    component.__bindings__[path] = component.__bindings__[path] || [];
  }

  function traverseNodeAndDo(pointer, callback) { // inspiration: http://www.javascriptcookbook.com/article/Traversing-DOM-subtrees-with-a-recursive-walk-the-DOM-function/
    callback(pointer);

    pointer = pointer.firstChild;
    while (pointer) {
      if (pointer.nodeName === '#text') {
        var splitArray = splitTextNodeByTemplates(pointer);
        if (Array.isArray(splitArray)) {
          splitArray.forEach(
            pipe(
              callback,
              function (node) {
                pointer.parentNode.insertBefore(node, pointer);
              }
            )
          );
          pointer = pointer.previousSibling;
          pointer.parentNode.removeChild(pointer.nextSibling);
        }
      } else traverseNodeAndDo(pointer, callback);
      pointer = pointer.nextSibling;
    }
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
        if (logger) logger({
          action: 'set',
          target: target,
          value: value,
          receiver: receiver,
          path: JSONPath(basePath, property)
        });

        if (typeof value === 'object' && !Array.isArray(value)) Reflect.set(target, property, proxyfull(value, handler, logger, JSONPath(basePath, property)));
        else Reflect.set(target, property, value);

        Reflect.set(original, property, value);

        if (handler.set) return handler.set(target, property, value, receiver, JSONPath(basePath, property));
        else return true;
      }
    });

    return new Proxy(_target, _handler);

  }

  function JSONPath(basePath, property) {
    return (basePath + '.' + property)
      .match(/[^\.].*/)[0];
  }

  return rudy;
}));