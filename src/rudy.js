rudy = function (id, component) {
    component.template = component.template || document.getElementById(id).innerHTML;
    component.data = createDeepProxy(component.data, viewRefresher(id, component));
    if (typeof component.create === 'function') component.create.call(component.data);
    viewRefresher(id, component)();
    return component;
}

function viewRefresher(id, component) {
    return function refreshView() {
        if (Object.getOwnPropertyNames(component.data).length > 0 && component.template !== '') {
            substituteValues(component.template, component.data, function (error, result) {
                if (result) document.getElementById(id).innerHTML = result;
            });
            findAllInputElements(document.getElementById(id)).forEach(function (inputElement) {
                var value = getProperty(component.data, inputElement.getAttribute('name'));
                if (typeof value !== 'undefined') {
                    if (inputElement.getAttribute('type') == 'checkbox') inputElement.checked = value;
                    else inputElement.value = value;
                }
            });
        }
    };
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

function createDeepProxy(original, setter, stack) {
    if (typeof stack === 'undefined') stack = 'root';
    var newOriginal = Object.assign({}, original);

    Object.keys(newOriginal).forEach(function (key) {
        if (typeof newOriginal[key] === "object") {
            newOriginal[key] = createDeepProxy(newOriginal[key], setter, stack + '.' + key);
        }
    });

    return new Proxy(
        newOriginal, {
            get: function (target, property) {
                return target[property];
            },
            set: function (target, property, value, receiver) {

                if (typeof value === 'object') target[property] = createDeepProxy(value, setter, stack + '.' + property);
                else target[property] = value;
                setter(value, stack + '.' + property);
            }
        });
}