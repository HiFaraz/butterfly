'use strict';

var moduleTarget = (typeof global === 'undefined') ? window : global;

moduleTarget.rudy = function (id, component) {
    component.template = component.template || document.getElementById(id).innerHTML;

    var __original_data__ = Object.assign({}, component.data);
    var __proxy__ = null;

    Object.defineProperty(component, 'data', {
        get: function () {
            return __proxy__;
        },
        set: function (value) {
            console.log('SET DATA', value);
            var __new_data__ = Object.assign({}, value);
            __proxy__ = proxyfull(__new_data__, viewRefresher(id, this));
            if (typeof this.create === 'function') {
                this.__create__ = this.create;
                this.create.call(this.data);
                delete this.create;
            }
            viewRefresher(id, this)();
        },
    });

    component.data = __original_data__;

    return component;
}

function viewRefresher(id, component) {
    return function refreshView() {
        if (Object.getOwnPropertyNames(component.data).length > 0 && component.template !== '') {

            var cache = {};

            substituteValues(
                component.template,
                component.data,
                function (error, result, cachedValues) {
                    if (result) {
                        document.getElementById(id).innerHTML = result;
                        cache = cachedValues;
                    }
                }
            );

            findAllInputElements(document.getElementById(id))
                .forEach(function (inputElement) {
                    var value = cache[inputElement.getAttribute('name')] || getProperty(component.data, inputElement.getAttribute('name'));
                    if (typeof value !== 'undefined') {
                        if (typeof value === 'function') value = value.call(Object.assign({}, component.data));
                        if (inputElement.getAttribute('type') === 'checkbox') inputElement.checked = value;
                        else inputElement.value = value;
                    }
                });
        }
        return true;
    };
}

function substituteValues(initialHTML, data, callback) {
    var atleastOneValidMatchFound = false;
    var html = initialHTML;
    var matches = html.match(/{{(.+?)}}/g);
    var cache = {};
    if (matches) {
        matches.forEach(function (match) {
            var prop = match.replace(/[{}]/g, '').trim();
            var value = getProperty(data, prop);
            if (typeof value !== 'undefined') {
                if (typeof value === 'function') cache[prop] = value = value.call(Object.assign({}, data));
                atleastOneValidMatchFound = true;
                html = html.replace(match, value);
            }
        });
    }
    if (atleastOneValidMatchFound && callback) callback(null, html, cache);
    else if (callback) callback(true);
}

function getProperty(source, property) {
    if (source && property) return property
        .split('.')
        .reduce(function (initial, key) {
            if (typeof initial === 'undefined') return undefined;
            else return initial[key];
        }, source);
    else return undefined;
}

function findAllInputElements(rootElement) {
    var inputs = [];
    var elementsToCheck = rootElement.childNodes;
    var elementsRemaining;
    do {
        elementsRemaining = [];
        [].forEach.call(elementsToCheck, function (node) {
            if (['INPUT', 'RANGE', 'SELECT', 'TEXTAREA'].indexOf(node.tagName) > -1) inputs.push(node);
            else if (node.childNodes.length > 0) elementsRemaining.push.apply(elementsRemaining, node.childNodes);
        })
        elementsToCheck = elementsRemaining;
    }
    while (elementsToCheck.length > 0)
    return inputs;
}

function proxyfull(original, setter, stack) {
    if (typeof stack === 'undefined') stack = '';
    var newOriginal = Object.assign({}, original);

    Object.keys(newOriginal).forEach(function (key) {
        if (typeof newOriginal[key] === "object") {
            newOriginal[key] = proxyfull(newOriginal[key], setter, stack + '/' + key);
        }
    });

    return new Proxy(
        newOriginal, {
            get: function (target, property) {
                return target[property];
            },
            set: function (target, property, value, receiver) {
                console.log('SET', stack + '/' + property, value)

                if (typeof value === 'object') target[property] = proxyfull(value, setter, stack + '/' + property);
                else {
                    target[property] = value;
                    original[property] = value;
                }
                return setter(value, stack + '/' + property);
            }
        }
    );
}