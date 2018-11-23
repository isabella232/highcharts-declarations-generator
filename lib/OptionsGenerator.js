"use strict";
/* *
 *
 *  Copyright (c) Highsoft AS. All rights reserved.
 *
 * */
Object.defineProperty(exports, "__esModule", { value: true });
const Config = require("./Config");
const TSD = require("./TypeScriptDeclarations");
const Utils = require("./Utilities");
function generate(optionsJSON) {
    return new Promise((resolve, reject) => {
        const generator = new Generator(optionsJSON);
        resolve(generator.mainNamespace);
    });
}
exports.generate = generate;
const ANY_TYPE = /^any$|([\<\(\|])any([\|\)\>])/;
class Generator {
    /* *
     *
     *  Static Functions
     *
     * */
    static getCamelCaseName(node) {
        let name = (node.meta.fullname || node.meta.name || '');
        if (name.indexOf('Highcharts.') > -1) {
            name = name.substr(11);
        }
        return (TSD.IDeclaration
            .namespaces(name)
            .map(Utils.capitalize)
            .join('')
            .replace('Options', '') +
            'Options');
    }
    static getNormalizedDoclet(node) {
        let doclet = node.doclet, description = (node.doclet.description || '').trim(), name = (node.meta && (node.meta.fullname || node.meta.name) || ''), removedLinks = [];
        description = Utils.removeExamples(description);
        description = Utils.removeLinks(description, removedLinks);
        description = Utils.transformLists(description);
        if (doclet.see) {
            removedLinks.push(...doclet.see);
            delete doclet.see;
        }
        if (doclet.type && doclet.type.names) {
            doclet.type.names = doclet.type.names.map(type => Config.mapType(type));
        }
        else {
            doclet.type = { names: ['any'] };
        }
        if (doclet.products) {
            removedLinks.length = 0;
            doclet.products.forEach(product => removedLinks.push(Config.seeLink(name, 'option', product)));
            if (description &&
                description[0] !== '(') {
                description = ('(' + doclet.products
                    .map(Utils.capitalize)
                    .join(', ') +
                    ') ' + description);
            }
        }
        if (removedLinks.length > 0) {
            doclet.see = removedLinks
                .map(link => Utils.urls(link)[0])
                .filter(link => !!link);
        }
        doclet.description = description;
        return doclet;
    }
    /* *
     *
     *  Constructor
     *
     * */
    constructor(optionsJSON) {
        this._mainNamespace = new TSD.ModuleGlobalDeclaration('Highcharts');
        this._seriesTypes = [];
        this.generateInterfaceDeclaration({
            children: optionsJSON,
            doclet: {
                description: 'The option tree for every chart.'
            },
            meta: {
                filename: '',
                fullname: 'Highcharts.Options',
                line: 0,
                lineEnd: 0
            }
        });
        this.generateSeriesDeclaration();
    }
    /* *
     *
     *  Properties
     *
     * */
    get mainNamespace() {
        return this._mainNamespace;
    }
    /* *
     *
     *  Functions
     *
     * */
    generateInterfaceDeclaration(sourceNode) {
        if (sourceNode.doclet.access === 'private') {
            return undefined;
        }
        let doclet = Generator.getNormalizedDoclet(sourceNode), name = Generator.getCamelCaseName(sourceNode), declaration = new TSD.InterfaceDeclaration(name), children = Utils.Dictionary.values(sourceNode.children);
        if (doclet.description) {
            declaration.description = doclet.description;
        }
        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }
        this.mainNamespace.addChildren(declaration);
        if (name === 'SeriesOptions') {
            children
                .filter(child => Object.keys(child.children).length === 0)
                .forEach(child => this.generatePropertyDeclaration(child, declaration));
            children
                .filter(child => Object.keys(child.children).length > 0)
                .forEach(child => {
                let seriesDeclaration = this.generateSeriesTypeDeclaration(child, declaration);
                if (seriesDeclaration) {
                    this._seriesTypes.push(seriesDeclaration.fullName);
                }
            });
        }
        else {
            children.forEach(child => this.generatePropertyDeclaration(child, declaration));
        }
        return declaration;
    }
    generatePropertyDeclaration(sourceNode, targetDeclaration) {
        if (sourceNode.doclet.access === 'private') {
            return undefined;
        }
        let doclet = Generator.getNormalizedDoclet(sourceNode);
        if (Object.keys(sourceNode.children).length > 0) {
            let interfaceDeclaration = this.generateInterfaceDeclaration(sourceNode), replacedAnyType = false;
            if (!interfaceDeclaration) {
                return;
            }
            sourceNode.children = {};
            sourceNode.doclet.type = (sourceNode.doclet.type || { names: [] });
            sourceNode.doclet.type.names = sourceNode.doclet.type.names
                .map(type => Config.mapType(type))
                .map(type => {
                if (ANY_TYPE.test(type) &&
                    interfaceDeclaration) {
                    replacedAnyType = true;
                    return type.replace(new RegExp(ANY_TYPE, 'gm'), '$1' + interfaceDeclaration.name + '$2');
                }
                return type;
            });
            if (!replacedAnyType) {
                sourceNode.doclet.type.names.push(interfaceDeclaration.fullName);
            }
        }
        let declaration = new TSD.PropertyDeclaration(sourceNode.meta.name || '');
        if (doclet.description) {
            declaration.description = doclet.description;
        }
        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }
        if (sourceNode.meta.fullname !== 'series.type') {
            declaration.isOptional = true;
        }
        let isValueType = false;
        if (doclet.values) {
            let values = Utils.json(doclet.values, true);
            if (values instanceof Array) {
                let mergedTypes = Utils.uniqueArray(declaration.types, values.map(Config.mapValue));
                declaration.types.length = 0;
                declaration.types.push(...mergedTypes);
                isValueType = true;
            }
        }
        if (!isValueType &&
            doclet.type) {
            let mergedTypes = Utils.uniqueArray(declaration.types, doclet.type.names);
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }
        targetDeclaration.addChildren(declaration);
        return declaration;
    }
    generateSeriesTypeDeclaration(sourceNode, targetDeclaration) {
        if (sourceNode.doclet.access === 'private' ||
            !sourceNode.meta.name) {
            return undefined;
        }
        let doclet = Generator.getNormalizedDoclet(sourceNode), name = Generator.getCamelCaseName(sourceNode), declaration = new TSD.InterfaceDeclaration(name);
        if (doclet.description) {
            declaration.description = doclet.description;
        }
        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }
        declaration.types.push(('Highcharts.Plot' +
            Utils.capitalize(sourceNode.meta.name) +
            'Options'), 'Highcharts.SeriesOptions');
        let dataNode = sourceNode.children['data'];
        if (!dataNode) {
            console.error('No data description found!');
            return;
        }
        this.mainNamespace.addChildren(declaration);
        this.generatePropertyDeclaration(dataNode, declaration);
        let typePropertyDeclaration = new TSD.PropertyDeclaration('type');
        typePropertyDeclaration.description = ('(' + Config.products.map(Utils.capitalize).join(', ') + ') ' +
            'This property is only in TypeScript non-optional and might be ' +
            '`undefined` in series objects from unknown sources.');
        typePropertyDeclaration.types.push('"' + sourceNode.meta.name + '"');
        declaration.addChildren(typePropertyDeclaration);
        (sourceNode.doclet.exclude || []).forEach(exclude => {
            if (!declaration.getChildren(exclude)) {
                let excludeDeclaration = new TSD.PropertyDeclaration(exclude);
                excludeDeclaration.isOptional = true;
                excludeDeclaration.types.push('undefined');
                declaration.addChildren(excludeDeclaration);
            }
        });
        return declaration;
    }
    generateSeriesDeclaration() {
        let optionsDeclaration = this.mainNamespace.getChildren('Options')[0];
        if (!optionsDeclaration) {
            console.error('Highcharts.Options not declared!');
            return;
        }
        let seriesPropertyDeclaration = optionsDeclaration.getChildren('series')[0];
        if (!seriesPropertyDeclaration) {
            console.error('Highcharts.Options#series not declared');
            return;
        }
        let seriesTypeDeclaration = new TSD.TypeDeclaration('SeriesType');
        seriesTypeDeclaration.description = 'The possible series types.';
        seriesTypeDeclaration.types.push(...this._seriesTypes);
        this.mainNamespace.addChildren(seriesTypeDeclaration);
        seriesPropertyDeclaration.types.length = 0;
        seriesPropertyDeclaration.types.push('Array<SeriesType>');
    }
    toString() {
        return this.mainNamespace.toString();
    }
}
//# sourceMappingURL=OptionsGenerator.js.map