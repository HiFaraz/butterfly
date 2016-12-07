// do not delete!
// this is the older version with setters, it might work on IE. but it can't take new properties that don't already have setters on them


rudy = function (id, component) {
    var element = document.getElementById(id);

    if (typeof component.create === 'function') component.create.call(component.data);

    component.template = component.template || element.innerHTML;

    var newComponentWithDataSetters = {
        data: {}
    }

    newComponentWithDataSetters = createDeepSetter(
        newComponentWithDataSetters,
        function (value) {
            if (typeof value !== 'function' && Object.getOwnPropertyNames(newComponentWithDataSetters.data).length > 0 && component.template !== '') {
                console.log('UPDATE', newComponentWithDataSetters.data)
                substituteValues(component.template, newComponentWithDataSetters.data, function (error, result) {
                    if (error) console.log('no matches found!')
                    if (result) document.getElementById(id).innerHTML = result;
                });

                findAllInputElements(document.getElementById(id)).forEach(function (inputElement) {
                    var value = getProperty(newComponentWithDataSetters.data, inputElement.getAttribute('name'));
                    if (typeof value !== 'undefined') {
                        if (inputElement.getAttribute('type') == 'checkbox') inputElement.checked = value;
                        else inputElement.value = value;
                    }
                });
            }
        }
    );

    Object.keys(component)
        .forEach(function (key) {
            newComponentWithDataSetters[key] = component[key];
        });

    return newComponentWithDataSetters;
}

function substituteValues(initialHTML, data, callback) {
    var atleastOneValidMatchFound = false;
    var html = initialHTML;
    var matches = html.match(/{{(.+?)}}/g);
    if (matches) {
        matches.forEach(function (match) {
            var prop = match.replace(/[{}]/g, '').trim();
            var value = getProperty(data, prop);
            if (typeof value !== 'undefined') {
                atleastOneValidMatchFound = true;
                html = html.replace(match, value);
            }
        });
    }
    if (atleastOneValidMatchFound && callback) callback(null, html);
    else if (callback) callback(true);
}

function getProperty(source, property) {
    return property
        .split('.')
        .reduce(function (initial, key) {
            if (typeof initial === 'undefined') return undefined;
            else return initial[key];
        }, source);
}

function findAllInputElements(rootElement) {
    var inputs = [];
    var elementsToCheck = rootElement.childNodes;
    var elementsRemaining;
    do {
        elementsRemaining = [];
        [].forEach.call(elementsToCheck, function (node) {
            if (node.tagName === 'INPUT') inputs.push(node);
            else if (node.childNodes.length > 0) elementsRemaining.push.apply(elementsRemaining, node.childNodes);
        })
        elementsToCheck = elementsRemaining;
    }
    while (elementsToCheck.length > 0)
    return inputs;
}

function createDeepSetter(obj, setter, stack) {
    if (typeof stack === 'undefined') stack = 'root';
    console.log('ENTER', stack, obj);
    var newObj = {};
    var data = Object.assign({}, obj);

    Object.keys(obj).forEach(function (key) {
        if (obj.hasOwnProperty(key)) {
            if (typeof obj[key] == "object") {
                console.log('OBJECT', key, '@', stack, obj[key]);
                Object.defineProperty(newObj, key, {
                    get: function () {
                        return data[key];
                    },
                    set: function (newValue) {
                        console.log('SET', stack + '.' + key, newValue);
                        if (typeof newValue === 'object') data[key] = createDeepSetter(newValue, setter, stack + '.' + key);
                        else data[key] = newValue;
                        setter(newValue, stack + '.' + key);
                    }
                });
                newObj[key] = obj[key];
            } else {
                console.log('VALUE', key, '@', stack, obj[key]);
                Object.defineProperty(newObj, key, {
                    get: function () {
                        return data[key];
                    },
                    set: function (newValue) {
                        console.log('SET', stack + '.' + key, newValue);
                        data[key] = newValue;
                        setter(newValue, stack + '.' + key);
                    }
                });
            }
        }
    });
    return newObj;
}