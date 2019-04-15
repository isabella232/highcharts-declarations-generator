/*!*
 *
 *  Copyright (c) Highsoft AS. All rights reserved.
 *
 *!*/

import * as Config from './Config';
import * as Parser from './OptionsParser';
import * as TSD from './TypeScriptDeclarations';
import * as Utils from './Utilities';



export function generate (
    optionsNode: Parser.INode
): Promise<TSD.ModuleDeclaration> {

    return new Promise(
        resolve => resolve((new Generator(optionsNode)).namespace)
    );
}



const ANY_TYPE = /(^|[\<\(\|])any([\|\)\>]|$)/;



class Generator {

    /* *
     *
     *  Static Properties
     *
     * */

    private static _series: Array<string> = [];

    /* *
     *
     *  Static Functions
     *
     * */

    private static getCamelCaseName (name: string): string {

        return (TSD.IDeclaration
            .namespaces(name)
            .map(Utils.capitalize)
            .join('')
            .replace(/Options/g, '') +
            'Options'
        );
    }

    private static getNormalizedDoclet (node: Parser.INode): Parser.IDoclet {

        let doclet = node.doclet,
            description = (node.doclet.description || '').trim(),
            name = (node.meta.fullname || node.meta.name || ''),
            removedLinks = [] as Array<string>;

        description = Utils.removeExamples(description);
        description = Utils.removeLinks(description, removedLinks);
        description = Utils.transformLists(description);

        if (doclet.see) {
            removedLinks.push(...doclet.see);
            delete doclet.see;
        }

        if (doclet.type && doclet.type.names) {
            doclet.type.names = Utils.uniqueArray(
                doclet.type.names.map(type => Config.mapType(type))
            );
        }
        else {
            doclet.type = { names: [ 'any' ] };
        }

        if (doclet.products) {

            removedLinks.length = 0;

            doclet.products.forEach(product =>
                removedLinks.push(Config.seeLink(name, 'option', product))
            );

            if (description &&
                description[0] !== '('
            ) {
                description = (
                    '(' + doclet.products
                        .map(Utils.capitalize)
                        .join(', ') +
                    ') ' + description
                );
            }
        }

        if (!Config.withoutLinks && removedLinks.length > 0) {
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

    public constructor (parsedOptions: Parser.INode) {

        this._namespace = new TSD.ModuleDeclaration('Highcharts');

        this.generateInterfaceDeclaration(parsedOptions);
        this.generateSeriesDeclaration();
        this.generateLiteralTypeDeclarations();
    }

    /* *
     *
     *  Properties
     *
     * */

    public get namespace (): TSD.ModuleDeclaration {
        return this._namespace;
    }
    private _namespace: TSD.ModuleDeclaration;

    /* *
     *
     *  Functions
     *
     * */

    private generateInterfaceDeclaration (
        sourceNode: Parser.INode
    ): (TSD.InterfaceDeclaration|undefined) {

        if (sourceNode.doclet.access === 'private') {
            return undefined;
        }

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            name = Generator.getCamelCaseName(
                sourceNode.meta.fullname || sourceNode.meta.name || ''
            ),
            declaration = new TSD.InterfaceDeclaration(name),
            children = Utils.Dictionary.values(sourceNode.children);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        this.namespace.addChildren(declaration);

        if (name === 'SeriesOptions') {

            const seriesIndexer = {
                doclet: {
                    type: { names: [ '*' ] }
                },
                meta: {
                    fullname: 'series.[key:string]',
                    name: '[key:string]'
                },
                children: {}
            };

            children
                .filter(child => (
                    Object.keys(child.children).length === 0 ||
                    !child.doclet._extends ||
                    child.doclet._extends.every(
                        name => !name.startsWith('plotOptions')
                    )
                ))
                .concat(Utils.clone(seriesIndexer, Number.MAX_SAFE_INTEGER))
                .forEach(child => this.generatePropertyDeclaration(
                    child, declaration
                ));

            children
                .filter(child => (
                    Object.keys(child.children).length > 0 &&
                    child.doclet._extends &&
                    child.doclet._extends.some(
                        name => name.startsWith('plotOptions')
                    )
                ))
                .forEach(child => {

                    // indicators have no data option
                    if (child.children.data) {
                        child.children.data.children['[key:string]'] = Utils
                            .clone(seriesIndexer, Number.MAX_SAFE_INTEGER);
                    }

                    let seriesDeclaration = this.generateSeriesTypeDeclaration(
                        child, this.namespace
                    );

                    if (seriesDeclaration) {
                        Generator._series.push(seriesDeclaration.fullName);
                    }
                });
        }
        else {
            children.forEach(child => this.generatePropertyDeclaration(
                child, declaration
            ));
        }

        return declaration;
    }

    private generateLiteralTypeDeclarations (
        sourceDeclaration: TSD.IDeclaration = this._namespace
    ) {

        const types = sourceDeclaration.types;

        if (sourceDeclaration instanceof TSD.PropertyDeclaration &&
            types.length > 1 &&
            types.every(type => type.startsWith('"'))
        ) {

            let name = (
                'Options' + Utils.capitalize(sourceDeclaration.name) + 'Value'
            );

            const declaration = this.generateTypeDeclaration(name, types);

            if (declaration) {
                sourceDeclaration.types.length = 0;
                sourceDeclaration.types.push(declaration.fullName);
            }
        }

        if (sourceDeclaration.hasChildren) {
            sourceDeclaration
                .getChildren()
                .forEach(child => this.generateLiteralTypeDeclarations(child));
        }
    }

    private generatePropertyDeclaration (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.PropertyDeclaration|undefined) {

        if (sourceNode.doclet.access === 'private') {
            return undefined;
        }

        let doclet = Generator.getNormalizedDoclet(sourceNode);

        if (Object.keys(sourceNode.children).length > 0) {

            let interfaceDeclaration = this.generateInterfaceDeclaration(
                    sourceNode
                ),
                replacedAnyType = false;

            if (!interfaceDeclaration) {
                return;
            }

            sourceNode.children = {};
            sourceNode.doclet.type = (sourceNode.doclet.type || { names: [] });
            sourceNode.doclet.type.names = sourceNode.doclet.type.names
                .map(type => Config.mapType(type))
                .map(type => {
                    if (ANY_TYPE.test(type) && interfaceDeclaration) {
                        replacedAnyType = true;
                        return type.replace(
                            new RegExp(ANY_TYPE, 'gm'),
                            '$1' + interfaceDeclaration.name + '$2'
                        );
                    }
                    return type;
                });

            if (!replacedAnyType) {
                sourceNode.doclet.type.names.push(
                    interfaceDeclaration.fullName
                );
            }

            sourceNode.doclet.type.names = Utils.uniqueArray(
                sourceNode.doclet.type.names
            );
        }

        let declaration = new TSD.PropertyDeclaration(
            sourceNode.meta.name || ''
        );

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
                let mergedTypes = Utils.uniqueArray(
                    declaration.types, values.map(Config.mapValue)
                );
                declaration.types.length = 0;
                declaration.types.push(...mergedTypes);
                isValueType = true;
            }
        }

        if (!isValueType && doclet.type) {
            const mergedTypes = Utils.uniqueArray(
                declaration.types, doclet.type.names
            );
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }

        targetDeclaration.addChildren(declaration);

        return declaration;
    }

    private generateSeriesDeclaration () {

        let optionsDeclaration = this.namespace.getChildren('Options')[0];

        if (!optionsDeclaration) {
            throw new Error('Highcharts.Options not declared!');
        }

        let seriesPropertyDeclaration = optionsDeclaration.getChildren(
            'series'
        )[0];

        if (!seriesPropertyDeclaration) {
            throw new Error('Highcharts.Options#series not declared!');
        }

        let seriesTypeDeclaration = new TSD.TypeDeclaration(
            'SeriesOptionsType'
        );

        seriesTypeDeclaration.description = (
            'The possible types of series options.'
        );
        seriesTypeDeclaration.types.push(...Generator._series);

        this.namespace.addChildren(seriesTypeDeclaration);

        seriesPropertyDeclaration.types.length = 0;
        seriesPropertyDeclaration.types.push(
            'Array<Highcharts.SeriesOptionsType>'
        );
    }
 
    private generateSeriesTypeDeclaration (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.ModuleDeclaration
    ): (TSD.InterfaceDeclaration|undefined) {

        if (!sourceNode.meta.name ||
            sourceNode.doclet.access === 'private'
        ) {
            return undefined;
        }

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            name = Generator.getCamelCaseName(
                sourceNode.meta.fullname || sourceNode.meta.name || ''
            ),
            declaration = new TSD.InterfaceDeclaration(name),
            children = sourceNode.children,
            extendedChildren = [ 'type' ] as Array<string>;

        (sourceNode.doclet._extends || [])
            .map(name => Generator.getCamelCaseName(name))
            .map(name => this.namespace.getChildren(name)[0])
            .forEach(
                declaration =>
                    extendedChildren.push(...declaration.getChildrenNames())
            );
        extendedChildren = Utils.uniqueArray(extendedChildren);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        declaration.types.push(
            (
                'Highcharts.Plot' +
                Utils.capitalize(sourceNode.meta.name) +
                'Options'
            ),
            'Highcharts.SeriesOptions'
        );

        let typePropertyDeclaration = new TSD.PropertyDeclaration('type');

        typePropertyDeclaration.description = (
            '(' + Object.keys(Config.products).map(Utils.capitalize).join (', ') + ') ' +
            'This property is only in TypeScript non-optional and might be ' +
            '`undefined` in series objects from unknown sources.'
        );
        typePropertyDeclaration.types.push('"' + sourceNode.meta.name + '"');

        declaration.addChildren(typePropertyDeclaration);

        targetDeclaration.addChildren(declaration);

        Object
            .keys(children)
            .filter(childName => extendedChildren.indexOf(childName) === -1)
            .forEach(
                childName =>
                    this.generatePropertyDeclaration(
                        children[childName], declaration
                    )
            );

        Utils
            .uniqueArray(sourceNode.doclet.exclude || [])
            .filter(childName => extendedChildren.indexOf(childName) === -1)
            .filter(
                childName => declaration.getChildren(childName).length === 0
            )
            .forEach(
                childName => {
                    const child = new TSD.PropertyDeclaration(childName);
                    child.description = 'Not available';
                    child.isOptional = true;
                    child.types.push('undefined');
                    declaration.addChildren(child);
                }
            );

        return declaration;
    }

    private generateTypeDeclaration (
        name: string, types: Array<string>, description?: string
    ): (TSD.TypeDeclaration|undefined) {

        const existingDeclaration = this.namespace.getChildren(name)[0];

        if (existingDeclaration instanceof TSD.TypeDeclaration) {

            if (Utils.isDeepEqual(existingDeclaration.types, types)) {
                return existingDeclaration;
            }

            console.error(name + ' already exists with different types');
            console.info(existingDeclaration.types, 'vs.', types);
            console.info('Merge types of ' + name);

            const mergedTypes = Utils.uniqueArray(
                existingDeclaration.types,
                types
            );

            existingDeclaration.types.length = 0;
            existingDeclaration.types.push(...mergedTypes);

            return existingDeclaration;
        }

        const newDeclaration = new TSD.TypeDeclaration(name);

        if (description) {
            newDeclaration.description = description;
        }

        newDeclaration.types.push(...types);

        this.namespace.addChildren(newDeclaration);

        return newDeclaration;
    }

    public toString (): string {

        return this.namespace.toString();
    }
}
