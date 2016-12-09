'use strict';

function rudy(component) {

  validate(component);
  mapBindings(component).then(syncAllPathsToView);
  createProxyData(component);
  component.__livePaths__ = [];
  return component;
}

function addBinder(component, path, binder) {
  var value = getProperty(component.__data__, path);
  if (typeof value === 'function' && component.__livePaths__.indexOf(path) === -1) component.__livePaths__.push(path);
  component.__bindings__[path].push(binder);
}

function buildDOM(component) {

  var template =
    (function (component) {
      if (component.templateURL) return getTemplateFromURL(component.templateURL);
      else if (component.template) return Promise.resolve(component.template);
      else return Promise.reject();
    })(component);

  return template
    .then(stringToDOMNodes)
    .catch(function (error) {
      return document.querySelector(component.target).childNodes;
    });

}

function createPatcher(component) {
  return function patch(target, property, value, receiver, path) {
    if (typeof value === 'function') value = value.call(Object.assign({}, component.__data__));
    console.log('SET', path, value);
    if (component.__bindings__[path]) component.__bindings__[path].forEach(function (binder) {
      binder(value);
    });
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
      console.log('SET DATA', value);
      component.__data__ = Object.assign({}, value);
      __proxy__ = new proxyfull(component.__data__, {
        set: function () {

          if (component.__livePaths__) component.__livePaths__.forEach(function (path) {
            syncPathToView(component, path, createPatcher(component));
          });

          return createPatcher(component).apply({}, arguments);
        }
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
  return new Promise(function (resolve, reject) {

    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.onload = function () {
      if (request.readyState != 4 || request.status != 200) reject();
      else resolve(request.responseText);
    };
    try {
      request.send();
    } catch (error) {
      reject(error);
    }

  });
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

  return buildDOM(component)
    .then(flattenNodeList)
    .then(splitTextNodesByTemplates)
    .then(function (nodes) {
      nodes.forEach(buildBinding);
      return component;
    });

  function buildBinding(node) {
    var typeTable = {};

    typeTable['INPUT'] = function (node) {
      if (node.getAttribute('name')) {
        touchBinding(component, node.getAttribute('name'));
        var attr = (node.getAttribute('type') === 'checkbox') ? 'checked' : 'value';
        addBinder(component, node.getAttribute('name'), function (value) {
          node[attr] = value;
        });
      }
    };

    ['RANGE', 'SELECT', 'TEXTAREA'].forEach(function (type) {
      typeTable[type] = function (node) {
        if (node.getAttribute('name')) {
          touchBinding(component, node.getAttribute('name'));
          addBinder(component, node.getAttribute('name'), function (value) {
            node.value = value;
          });
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
      }
    };

    if (typeof node.nodeName !== 'undefined' && typeTable[node.nodeName]) typeTable[node.nodeName](node);
  }
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