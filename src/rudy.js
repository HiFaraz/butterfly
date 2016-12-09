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

    validate(component);
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
    if (component.templateURL) getTemplateFromURL(component.templateURL, pipe(function (error, result) {
      if (error) throw Error('Could not download component template from ' + component.templateURL);
      if (result) return result;
    }, stringToDOMNodes, callback));
    else if (component.template) callback(stringToDOMNodes(component.template));
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

  function flattenNodeList(nodes) {
    var flatNodeList = [];
    nodes.forEach(function (node) {
      traverseDOM(node, function (node) {
        flatNodeList.push(node);
      })
    });
    return flatNodeList;
  }

  function getTemplateFromURL(url, callback) {

    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.onload = function () {
      console.timeEnd('Time to get partial');
      if (request.readyState != 4 || request.status != 200) callback(true);
      else callback(null, request.responseText);
    };
    try {
      console.time('Time to get partial')
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
    console.time('Time to get nodes');
    component.__bindings__ = {};

    var dom = buildDOM(
      component,
      pipe(
        function (domResult) {
          console.timeEnd('Time to get nodes');
          console.time('Time to render first view');
          return dom = domResult;
        },
        flattenNodeList,
        splitTextNodesByTemplates,
        buildBindingsForNodeList,
        syncAllPathsToView,
        publishDOM,
        function () {
          console.timeEnd('Time to render first view');
        }
      ));

    function buildBinding(node) {
      var typeTable = {};

      typeTable.INPUT = function (node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
          addBinder(component, node.getAttribute('name'), function (value) {
            node[attr] = value;
          });
          setEventListenersOnFormElements(node, attr);
        }
      };

      ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function (type) {
        typeTable[type] = function (node) {
          if (node.getAttribute('name')) {
            touchBinding(component, node.getAttribute('name'));
            addBinder(component, node.getAttribute('name'), function (value) {
              node.value = value;
            });
            setEventListenersOnFormElements(node);
          }
        };
      });

      typeTable['#text'] = function (node) {
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
    }

    function buildBindingsForNodeList(nodes) {
      nodes.forEach(buildBinding);
      return component;
    }

    function publishDOM(component) {
      var target = document.querySelector(component.target);
      if (target.innerHTML.trim() === '') {
        do {
          target.appendChild(dom[0]);
        } while (dom[0])
      }
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


  function splitTextNodesByTemplates(nodes) {
    var result = [];
    nodes.forEach(process);

    function process(node) {
      var arr;
      if (node.nodeName === '#text') result = result.concat(processTextNode(node));
      else result.push(node);
    }

    function processTextNode(node) {
      var matches = node.textContent.match(/{{(.+?)}}/g);
      if (matches) {
        return processTextNodeMatches(node, matches);
      } else return node;
    }

    function processTextNodeMatches(node, matches) {
      var result = splitTextContentByMatches(node.textContent, matches).map(function (textContent) {
        var element = document.createTextNode(textContent);
        node.parentNode.insertBefore(element, node);
        return element
      });
      node.parentNode.removeChild(node);
      return result;
    }

    function splitTextContentByMatches(textContent, matches) {
      var result = [textContent];

      matches.forEach(function (match) {
        result = splitTextContentListByMatch(result, match);
      });

      return result;
    }

    function splitTextContentListByMatch(textContents, match) {
      var result = [];
      textContents.forEach(function (textContent, index) {
        if (textContent.indexOf(match) > -1) {
          result.push.apply(result, insertItemBetweenEachElementOfArray(textContent.split(match), match));
        } else result.push(textContent);
      });
      return result;
    }

    return result;
  }

  function stringToDOMNodes(str) {
    return (new DOMParser()).parseFromString(str, 'text/html').body.childNodes;
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

  function traverseDOM(node, callback) { // credit: http://www.javascriptcookbook.com/article/Traversing-DOM-subtrees-with-a-recursive-walk-the-DOM-function/
    callback(node);
    node = node.firstChild;
    while (node) {
      traverseDOM(node, callback);
      node = node.nextSibling;
    }
  }

  function validate(component) {
    if (!component.target || !document.querySelector(component.target)) throw TypeError('Components must have a valid target');
    if (typeof component.data != 'object') throw TypeError('Components must have a valid target');
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