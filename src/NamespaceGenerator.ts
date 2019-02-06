/* *
 * 
 *  Copyright (c) Highsoft AS. All rights reserved.
 * 
 * */

import * as Config from './Config';
import * as Parser from './NamespaceParser';
import * as TSD from './TypeScriptDeclarations';
import * as Utils from './Utilities';



const COPYRIGHT: string = 'Copyright (c) Highsoft AS. All rights reserved.';



export function generate (
    namespaceModules: Utils.Dictionary<Parser.INode>
): Promise<Utils.Dictionary<TSD.ModuleDeclaration>> {

    return new Promise(resolve => {

        const declarations = {} as (
            Utils.Dictionary<TSD.ModuleDeclaration>
        );

        const products = Config.products;
        const productsModules = {} as Utils.Dictionary<string>;
        Object
            .keys(products)
            .forEach(product => productsModules[products[product]] = product);

        const globals = new TSD.ModuleDeclaration('globals');
        globals.description = COPYRIGHT;
        declarations['code/globals'] = globals;

        const declarationsGenerators = {} as Utils.Dictionary<Generator>;
        Object
            .keys(productsModules)
            .forEach(module => {

                const namespace = new TSD.ModuleDeclaration('Highcharts');
                namespace.imports.push('import * as globals from "./globals";');
                namespace.exports.push('export as namespace Highcharts;');

                declarationsGenerators[module] = new Generator(
                    globals, namespace, productsModules[module]
                );

                declarationsGenerators[module]
                    .generate(namespaceModules[Config.mainModule]);
            });

        Object
            .keys(namespaceModules)
            .forEach(module => {

                if (declarations[module] || productsModules[module]) {
                    return;
                }

                Object
                    .keys(declarationsGenerators)
                    .forEach(key => declarationsGenerators[key]
                        .generate(namespaceModules[module])
                    );

                declarations[module] = generateModule(module);
            });

        Object
            .keys(productsModules)
            .forEach(module =>
                declarations[module] = (
                    declarationsGenerators[module].namespace
                )
            );

        resolve(declarations);
    });
}



function generateModule (modulePath: string): TSD.ModuleDeclaration {

    const moduleGlobal = new TSD.ModuleDeclaration();
    moduleGlobal.description = COPYRIGHT;
    moduleGlobal.imports.push(
        ('import * as Highcharts from "' + Utils.relative(
            modulePath, Config.mainModule, true
        ) + '";')
    );
    moduleGlobal.exports.push('export default factory;');

    const factoryDeclaration = new TSD.FunctionDeclaration(
        'factory'
    );
    factoryDeclaration.description = (
        'Adds the module to the imported Highcharts namespace.'
    );

    const factoryParameterDeclaration = new TSD.ParameterDeclaration(
        'highcharts'
    );
    factoryParameterDeclaration.description = (
        'The imported Highcharts namespace to extend.'
    );
    factoryParameterDeclaration.types.push('typeof Highcharts');

    factoryDeclaration.setParameters(factoryParameterDeclaration);

    moduleGlobal.addChildren(factoryDeclaration);

    return moduleGlobal;
}



export function save (
    cliFeedback: Function,
    namespaceModules: Utils.Dictionary<TSD.ModuleDeclaration>,
    optionsModules: Utils.Dictionary<TSD.ModuleDeclaration>
): Promise<void> {

    const moduleStatement = /(".*\/(?:highcharts|globals)+)(";|" {)/g;
    const mainModule = namespaceModules[Config.mainModule];

    const modularProducts = Config.modularProducts;
    const modularProductsModules = {} as Utils.Dictionary<string>;
    Object
        .keys(modularProducts)
        .forEach(product =>
            modularProductsModules[modularProducts[product]] = product
        );

    const products = Config.products;
    const productsModules = {} as Utils.Dictionary<string>;        
    Object
        .keys(products)
        .forEach(product => productsModules[products[product]] = product);

    let declarations: TSD.ModuleDeclaration;
    Object
        .keys(namespaceModules)
        .forEach(module => {

            declarations = namespaceModules[module];

            if (optionsModules[module]) {
                declarations.addChildren(
                    ...
                    optionsModules[module].removeChildren()
                );
            }
        });

    const filePromises = [] as Array<Promise<string>>;
    Object
        .keys(namespaceModules)
        .forEach(module => {

            declarations = namespaceModules[module];

            if (modularProductsModules[module]) {
                const externalNamespace = new TSD.ExternalModuleDeclaration(
                    mainModule.name,
                    '../highcharts'
                );
                externalNamespace.addChildren(
                    ...
                    filterChildDeclarations(
                        namespaceModules[products[modularProductsModules[
                            module
                        ]]].getChildren(),
                        mainModule.getChildren(),
                        modularProductsModules[module]
                    )
                    .map(child => child.clone())
                );
                declarations.addChildren(externalNamespace);
/*                    filterModularProductModule(
                    mainModule,
                    namespaceModules[
                        products[modularProductsModules[module]]
                    ],
                    declarations
                );*/
            }

            if (productsModules[module]) {
                filterInvalidTypes(declarations);
            }

            filePromises.push(
                Utils.save(module + '.d.ts', declarations.toString()),
                Utils.save(
                    module + '.src.d.ts',
                    declarations
                        .toString()
                        .replace(moduleStatement, '$1.src$2')
                )
            );
        });

    return Promise
        .all(filePromises)
        .then(() => undefined);
}



function filterChildDeclarations (
    declarationsToFilter: Array<TSD.IDeclaration>,
    referenceDeclarations: Array<TSD.IDeclaration>,
    product: string
): Array<TSD.IDeclaration> {

    const filteredChildDeclarations = [] as Array<TSD.IDeclaration>;

    declarationsToFilter.forEach(declaration => {

        const foundReference = referenceDeclarations.find(reference => {
            if (reference.name === declaration.name) {
                return true;
            }
            else {
                return false;
            }
        });

        if (foundReference instanceof TSD.ClassDeclaration ||
            foundReference instanceof TSD.InterfaceDeclaration
        ) {
            const newDeclaration = new TSD.InterfaceDeclaration(
                declaration.name
            );
            newDeclaration.addChildren(
                ...
                filterChildDeclarations(
                    declaration.getChildren(),
                    foundReference.getChildren(),
                    product
                )
                .map(filteredChild => filteredChild.clone())
            );
            if (newDeclaration.hasChildren) {
                filteredChildDeclarations.push(newDeclaration);
            }
        }

        if (foundReference instanceof TSD.TypeDeclaration &&
            foundReference.name === 'SeriesOptionsType'
        ) {
            const newDeclaration = new TSD.TypeDeclaration(
                Utils.capitalize(product) + 'SeriesOptionsType'
            );
            newDeclaration.description = foundReference.description;
            newDeclaration.types.push(...foundReference.types);
            filteredChildDeclarations.push(newDeclaration);
        }
/*
        if (foundReference instanceof TSD.PropertyDeclaration &&
            foundReference.name === 'series' &&
            foundReference.parent instanceof TSD.InterfaceDeclaration &&
            foundReference.parent.name === 'Options'
        ) {
            const newDeclaration = new TSD.PropertyDeclaration('series');
            newDeclaration.isOptional = foundReference.isOptional;
            newDeclaration.types.push(
                'Array<Highcharts.SeriesOptionsType|Highcharts.' +
                Utils.capitalize(product) + 'SeriesOptionsType>'
            );
            filteredChildDeclarations.push(newDeclaration);
        }
*/
        if (foundReference ||
            declaration instanceof TSD.ConstructorDeclaration
        ) {
            return;
        }

        filteredChildDeclarations.push(declaration);
    });

    return filteredChildDeclarations;
}

function filterInvalidTypes (namespace: TSD.ModuleDeclaration) {

    const namespaceTypes = namespace.getChildrenNames(true);

    const removedTypes = [] as Array<string>;

    function filterTypes (declaration: TSD.IDeclaration) {

        const typeNames = TSD.IDeclaration
            .extractTypeNames(...declaration.types);

        let validTypes = [] as Array<string>;

        typeNames
            .filter(name => name.startsWith('Highcharts.'))
            .forEach(name => {

                if (namespaceTypes.some(type => type.startsWith(name))) {
                    return;
                }

                removedTypes.push(name);

                validTypes = Utils.uniqueArray(
                    declaration.types.map(type => 
                        type.replace(
                            new RegExp(
                                (
                                    name.replace('.', '\\.') +
                                    '(?=' +
                                    TSD.IDeclaration.TYPE_SEPARATOR +
                                    '|$)'
                                ),
                                'g'
                            ),
                            'any'
                        )
                    )
                );

                declaration.types.length = 0;
                declaration.types.push(...validTypes);
            });

        declaration.getChildren().forEach(filterTypes);

        if (declaration instanceof TSD.ConstructorDeclaration ||
            declaration instanceof TSD.FunctionDeclaration ||
            declaration instanceof TSD.FunctionTypeDeclaration
        ) {
            declaration.getParameters().forEach(filterTypes);
        }
    }

    filterTypes(namespace);

    console.log('Removed', removedTypes.join(', '));
}



function filterModularProductModule (
    mainNamespace: TSD.ModuleDeclaration,
    productNamespace: TSD.ModuleDeclaration,
    modularProductNamespace: TSD.ModuleDeclaration
): TSD.ModuleDeclaration {

    const mainName = mainNamespace.fullName;
    const mainTypes = mainNamespace.getChildrenNames();

    const modularNamespace = new TSD.ExternalModuleDeclaration(
        'Highcharts',
        '../highcharts'
    );
    modularProductNamespace.addChildren(modularNamespace);

    console.log(
        mainNamespace.getChildren().length,
        productNamespace.getChildren().length
    );

    modularNamespace.addChildren(
        ...filterUnknownChildDeclarations(
            productNamespace,
            mainNamespace
        )
    );

    console.log('Cloned', modularNamespace.getChildrenNames().join(', '));

    return modularProductNamespace;
}



function filterUnknownChildDeclarations (
    declarationToFilter: TSD.IDeclaration,
    referenceDeclaration: TSD.IDeclaration
): Array<TSD.IDeclaration> {

    let referenceChildNames: Array<string>;
    let childrenToFilter: Array<TSD.IDeclaration>;

    if (referenceDeclaration instanceof TSD.FunctionDeclaration &&
        declarationToFilter instanceof TSD.FunctionDeclaration
    ) {
        referenceChildNames = referenceDeclaration.getParameterNames();
        childrenToFilter = declarationToFilter.getParameters();
    }
    else {
        referenceChildNames = referenceDeclaration.getChildrenNames();
        childrenToFilter = declarationToFilter.getChildren();
    }

    const unknownChildren = [] as Array<TSD.IDeclaration>;
    childrenToFilter
        .forEach(childToFilter => {

            if (referenceChildNames.indexOf(childToFilter.name) === -1) {
                unknownChildren.push(childToFilter.clone());
                return;
            }

            switch (childToFilter.kind) {
                default:
                    return;
                case 'class':
                case 'function':
                case 'interface':
                case 'static function':
                    break;
            }

            const differences = [] as Array<TSD.IDeclaration>;
            const different = referenceDeclaration
                .getChildren(childToFilter.name)
                .every(referenceChild => {

                    const unknownChildChildren = filterUnknownChildDeclarations(
                        childToFilter,
                        referenceChild
                    );

                    differences.push(...unknownChildChildren);
                        
                    return unknownChildChildren.length > 0;
                });

            if (!different) {
                return;
            }

            if (childToFilter instanceof TSD.FunctionDeclaration) {
                const unknownChild = new TSD.FunctionDeclaration(
                    childToFilter.name
                );
                unknownChild.setParameters(
                    ...childToFilter
                        .getParameters()
                        .map(parameter => parameter.clone())
                );
                unknownChildren.push(unknownChild);
            }
            else {
                const unknownChild = new TSD.InterfaceDeclaration(
                    childToFilter.name
                );
                unknownChild.addChildren(
                    ...differences
                        .map(childChild => childChild.clone())
                );
                unknownChildren.push(unknownChild);
            }

        });

    return unknownChildren;
}



function mergeDeclarations(
    targetDeclaration: TSD.IDeclaration,
    sourceDeclaration: TSD.IDeclaration
) {

    if (!targetDeclaration.description) {
        targetDeclaration.description = sourceDeclaration.description;
    }

    targetDeclaration.types.push(...Utils.uniqueArray(
        targetDeclaration.types, sourceDeclaration.types
    ));

    let existingChild = undefined as (TSD.IDeclaration|undefined),
        sourceChildren = sourceDeclaration.getChildren(),
        targetChildrenNames = targetDeclaration.getChildrenNames();

    sourceChildren.forEach(sourceChild => {

        existingChild = targetDeclaration.getChildren(sourceChild.name)[0];

        if (existingChild) {
            mergeDeclarations(existingChild, sourceChild);
        } else {
            targetDeclaration.addChildren(sourceChild.clone());
        }
    });
}



class Generator {

    /* *
     *
     *  Static Properties
     *
     * */

    private static readonly OPTION_TYPE = (
        /^Highcharts.\w+(?:CallbackFunction|Object|Options)$/
    );

    /* *
     *
     *  Static Functions
     *
     * */

    private static getNormalizedDoclet(
        sourceNode: Parser.INode
    ): Parser.IDoclet {

        let doclet = Utils.clone(sourceNode.doclet || {
            description: '',
            kind: 'global',
            name: ''
        });

        let description = (doclet.description || '').trim(),
            namespaces = TSD.IDeclaration.namespaces(doclet.name || ''),
            removedLinks = [] as Array<string>,
            values;

        description = Utils.removeExamples(description);
        description = Utils.removeLinks(description, removedLinks);
        description = Utils.transformLists(description);

        doclet.description = description;
        doclet.name = (namespaces[namespaces.length - 1] || '');

        if (doclet.parameters) {

            let parameters = doclet.parameters,
                parameterDescription;

            Object
                .keys(parameters)
                .map(name => {

                    parameterDescription = parameters[name].description;

                    if (parameterDescription) {
                        parameterDescription = Utils.removeLinks(
                            parameterDescription, removedLinks
                        );
                        parameterDescription = Utils.transformLists(
                            parameterDescription
                        );
                        parameters[name].description = parameterDescription;
                    }

                    parameters[name].types = (
                        parameters[name].types || ['any']
                    ).map(
                        type => Config.mapType(type)
                    );
                });
        }

        if (doclet.products) {

            let products = doclet.products
                .map(Utils.capitalize)
                .join(', ');

            doclet.description = '(' + products + ') ' + description;
        }

        if (doclet.return) {

            let returnDescription = doclet.return.description;

            if (returnDescription) {
                returnDescription = Utils.removeLinks(
                    returnDescription, removedLinks
                );
                returnDescription = Utils.transformLists(
                    returnDescription
                );
                doclet.return.description = returnDescription;
            }

            doclet.return.types = (doclet.return.types || ['any']).map(
                type => Config.mapType(type)
            );
        }

        if (doclet.see) {
            removedLinks.push(...doclet.see);
            delete doclet.see;
        }

        if (doclet.values) {
            try {
                values = Utils.json(doclet.values, true);
            } catch (error) {
                console.error(error);
            }
        }

        if (values instanceof Array) {
            doclet.types = values.map(Config.mapValue);
        } else if (doclet.types) {
            doclet.types = doclet.types.map(
                type => Config.mapType(type, false)
            );
            if (doclet.name[0] !== '[' &&
                doclet.types.length > 1 &&
                doclet.types.some(type => type === 'undefined')
            ) {
                doclet.isOptional = true;
                doclet.types = doclet.types.filter(
                    type => type !== 'undefined'
                );
            }
        } else {
            doclet.types = [ 'any' ];
        }

        if (removedLinks.length > 0) {

            let see = [] as Array<string>;

            removedLinks.forEach(link =>
                see.push(...Utils.urls(link))
            );

            if (see.length > 0) {
                doclet.see = [
                    Config.seeLink(namespaces.join('.'), doclet.kind)
                ];
            }
        }

        return doclet;
    }

    /* *
     *
     *  Constructor
     *
     * */

    public constructor (
        globals: TSD.ModuleDeclaration,
        namespace: TSD.ModuleDeclaration,
        product?: string
    ) {

        this._globals = globals;
        this._namespace = namespace;
        this._product = (product || '');
    }

    /* *
     *
     *  Properties
     *
     * */

    public get globals(): TSD.ModuleDeclaration {
        return this._globals;
    }
    private _globals: TSD.ModuleDeclaration;

    public get product(): string {
        return this._product;
    }
    private _product: string;

    public get namespace(): TSD.ModuleDeclaration {
        return this._namespace;
    }
    private _namespace: TSD.ModuleDeclaration;

    /* *
     *
     *  Functions
     *
     * */

    public generate (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration = this._namespace,
        product: string = this._product
    ) {

        let kind = (sourceNode.doclet && sourceNode.doclet.kind || '');

        if (product &&
            sourceNode.doclet.products &&
            sourceNode.doclet.products.indexOf(product) === -1
        ) {
            return;
        }

        switch (kind) {
            default:
                console.error('Unknown kind: ' + kind, sourceNode);
                break;
            case 'class':
                this.generateClass(sourceNode, targetDeclaration);
                break;
            case 'constructor':
                this.generateConstructor(sourceNode, targetDeclaration);
                break;
            case 'external':
                this.generateExternal(sourceNode);
                break;
            case 'function':
                this.generateFunction(sourceNode, targetDeclaration);
                break;
            case 'global':
                this.generateModuleGlobal(sourceNode);
                break;
            case 'interface':
                this.generateInterface(sourceNode, targetDeclaration);
                break;
            case 'namespace':
                this.generateNamespace(sourceNode, targetDeclaration);
                break;
            case 'member':
                this.generateProperty(sourceNode, targetDeclaration);
                break;
            case 'typedef':
                if (sourceNode.doclet.parameters ||
                    sourceNode.doclet.return
                ) {
                    if (sourceNode.children &&
                        sourceNode.children.length > 0
                    ) {
                        this.generateFunctionInterface(
                            sourceNode, targetDeclaration
                        );
                    }
                    else {
                        this.generateFunctionType(
                            sourceNode, targetDeclaration
                        );
                    }
                }
                else if (sourceNode.children &&
                    sourceNode.children.length > 0 &&
                    sourceNode.doclet.types &&
                    sourceNode.doclet.types[0] !== '*'
                ) {
                    this.generateInterface(sourceNode, targetDeclaration);
                }
                else {
                    this.generateType(sourceNode, targetDeclaration);
                }
                break;
        }
    }

    private generateChildren (
        nodeChildren: Array<Parser.INode>,
        targetDeclaration: TSD.IDeclaration
    ) {

        nodeChildren.forEach(nodeChild =>
             this.generate(nodeChild, targetDeclaration)
        );
    }

    private generateClass (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.ClassDeclaration|undefined) {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.ClassDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }
        else if (targetDeclaration.kind !== this._namespace.kind) {
            targetDeclaration = this._namespace;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.ClassDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.types) {
            let mergedTypes = Utils.uniqueArray(
                declaration.types,
                doclet.types.filter(type => type !== type.toLowerCase())
            );
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private generateConstructor (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): TSD.ConstructorDeclaration {

        let declaration = new TSD.ConstructorDeclaration(),
            doclet = Generator.getNormalizedDoclet(sourceNode);

        if (doclet.description) {
            declaration.description = doclet.description;
        }
        else {
            (targetDeclaration.getChildren(declaration.name) || []).some(
                existingChild => {
                    if (existingChild.description &&
                        existingChild instanceof TSD.ConstructorDeclaration
                    ) {
                        declaration.description = existingChild.description;
                        return true;
                    }
                    else {
                        return false;
                    }
                }
            );
        }

        if (doclet.events) {
            declaration.addChildren(...this.generateEvents(doclet.events));
        }

        if (doclet.fires) {
            declaration.events.push(...doclet.fires);
        }

        if (doclet.isPrivate) {
            declaration.isPrivate = true;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.parameters) {

            let parameterDeclarations = this.generateParameters(
                doclet.parameters
            );

            if (parameterDeclarations.length > 1 &&
                parameterDeclarations[0].isOptional &&
                !parameterDeclarations[1].isOptional
            ) {
                let overloadedDeclaration = declaration.clone(),
                    overloadedParameterDeclarations = parameterDeclarations.map(
                        parameterDeclaration => parameterDeclaration.clone()
                    );

                overloadedParameterDeclarations.shift();
                overloadedDeclaration.setParameters(
                    ...overloadedParameterDeclarations
                );
                targetDeclaration.addChildren(overloadedDeclaration);

                parameterDeclarations[0].isOptional = false;
                declaration.setParameters(
                    ...parameterDeclarations
                );
            }
            else {
                declaration.setParameters(
                    ...parameterDeclarations
                );
            }
        }

        targetDeclaration.addChildren(declaration);

        return declaration;
    }

    private generateEvents (
        events: Utils.Dictionary<Parser.IEvent>
    ): Array<TSD.EventDeclaration> {

        let declaration;

        return Object
            .keys(events)
            .map(eventName => {

                declaration = new TSD.EventDeclaration(eventName);

                declaration.description = events[eventName].description;
                declaration.types.push(...events[eventName].types.map(
                    type => Config.mapType(type)
                ));

                return declaration;
            });
    }

    private generateExternal (
        sourceNode: Parser.INode
    ): TSD.InterfaceDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.InterfaceDeclaration(doclet.name),
            globalDeclaration = (
                this._namespace.getChildren('external:')[0] ||
                new TSD.NamespaceDeclaration('external:')
            );

        if (!globalDeclaration.parent) {
            this._namespace.addChildren(globalDeclaration);
        }

        let existingChild = globalDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.InterfaceDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (!declaration.parent) {
            globalDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private generateFunction (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): TSD.FunctionDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.FunctionDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }
        else {
            (targetDeclaration.getChildren(declaration.name) || []).some(
                existingChild => {
                    if (existingChild instanceof TSD.FunctionDeclaration &&
                        existingChild.description &&
                        existingChild.isStatic === doclet.isStatic
                    ) {
                        declaration.description = existingChild.description;
                        return true;
                    }
                    else {
                        return false;
                    }
                }
            );
        }

        if (doclet.events) {
            declaration.addChildren(...this.generateEvents(doclet.events));
        }

        if (doclet.fires) {
            declaration.events.push(...doclet.fires);
        }

        if (doclet.isPrivate) {
            declaration.isPrivate = true;
        }

        if (doclet.isStatic) {
            declaration.isStatic = true;
        }

        if (doclet.return) {
            if (doclet.return.description) {
                declaration.typesDescription = doclet.return.description;
            }
            if (doclet.return.types) {
                let mergedTypes = Utils.uniqueArray(
                    declaration.types, doclet.return.types
                );
                declaration.types.length = 0;
                declaration.types.push(...mergedTypes);
            }
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.parameters) {

            let parameterDeclarations = this.generateParameters(
                doclet.parameters
            );

            if (parameterDeclarations.length > 1 &&
                parameterDeclarations[0].isOptional &&
                !parameterDeclarations[1].isOptional
            ) {
                let overloadedDeclaration = declaration.clone(),
                    overloadedParameterDeclarations = parameterDeclarations.map(
                        parameterDeclaration => parameterDeclaration.clone()
                    );

                overloadedParameterDeclarations.shift();
                overloadedDeclaration.setParameters(
                    ...overloadedParameterDeclarations
                );
                targetDeclaration.addChildren(overloadedDeclaration);

                parameterDeclarations[0].isOptional = false;
                declaration.setParameters(
                    ...parameterDeclarations
                );
            }
            else {
                declaration.setParameters(
                    ...parameterDeclarations
                );
            }
        }

        targetDeclaration.addChildren(declaration);

        return declaration;
    }

    private generateFunctionInterface (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.InterfaceDeclaration|undefined) {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.InterfaceDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }
        else if (targetDeclaration.kind !== this._namespace.kind) {
            targetDeclaration = this._namespace;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.InterfaceDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        let functionDeclaration = new TSD.FunctionDeclaration('');

        existingChild = targetDeclaration.getChildren(
            functionDeclaration.name
        )[0];

        if (existingChild instanceof TSD.FunctionDeclaration) {
            functionDeclaration = existingChild;
        }

        if (doclet.description) {
            functionDeclaration.description = doclet.description;
        }

        if (doclet.parameters &&
            !functionDeclaration.hasParameters
        ) {
            functionDeclaration.setParameters(
                ...this.generateParameters(doclet.parameters)
            );
        }

        if (doclet.return) {
            if (doclet.return.description) {
                functionDeclaration.typesDescription = (
                    doclet.return.description
                );
            }
            if (doclet.return.types) {
                let mergedTypes = Utils.uniqueArray(
                    functionDeclaration.types,
                    doclet.return.types
                );
                functionDeclaration.types.length = 0;
                functionDeclaration.types.push(...mergedTypes);
            }
        }

        if (!functionDeclaration.parent) {
            declaration.addChildren(functionDeclaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private generateFunctionType (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.FunctionTypeDeclaration|undefined) {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.FunctionTypeDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }
        else if (targetDeclaration.kind !== this._namespace.kind) {
            targetDeclaration = this._namespace;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.FunctionTypeDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.parameters &&
            !declaration.hasParameters
        ) {
            declaration.setParameters(
                ...this.generateParameters(doclet.parameters)
            );
        }

        if (doclet.return) {
            if (doclet.return.description) {
                declaration.typesDescription = doclet.return.description;
            }
            if (doclet.return.types) {
                let mergedTypes = Utils.uniqueArray(
                    declaration.types,
                    doclet.return.types
                );
                declaration.types.length = 0;
                declaration.types.push(...mergedTypes);
            }
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        return declaration;
    }

    private generateInterface (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): TSD.InterfaceDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.InterfaceDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }
        else if (targetDeclaration.kind !== this._namespace.kind) {
            targetDeclaration = this._namespace;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.InterfaceDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.types) {
            let mergedTypes = Utils.uniqueArray(
                declaration.types,
                doclet.types.filter(type => type !== type.toLowerCase())
            );
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }
/*
    private generateModule (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): TSD.ModuleDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            // reference namespace of highcharts.js with module path
            declaration = new TSD.ModuleDeclaration(
                this._namespace.name,
                Utils.relative(this._file, Config.mainModule, true)
            );

        if (doclet.isGlobal) {
            // add global declaration in the current module file scope
            targetDeclaration = this._global;
        }

        let existingChild = targetDeclaration.getChildren(Config.mainModule)[0];

        if (existingChild instanceof TSD.ModuleDeclaration) {
            declaration = existingChild;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }
*/
    private generateModuleGlobal (
        sourceNode: Parser.INode
    ): TSD.ModuleDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = this._namespace;

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (!this._namespace.description) {
            this._namespace.description = declaration.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (this._namespace.hasChildren) {
            declaration.addChildren(...this._namespace.removeChildren());
        }

        this._namespace = declaration;

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private generateNamespace (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): TSD.IDeclaration {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.NamespaceDeclaration(doclet.name);

        // creates a sub namespace if special keyword, use namespace if not
        if (!doclet.name.endsWith(':')) {

            if (sourceNode.children) {
                this.generateChildren(sourceNode.children, this._namespace);
            }

            return this._namespace;
        }

        if (doclet.isGlobal) {
            // add global declaration in the current module file scope
            targetDeclaration = this._globals;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.NamespaceDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private generateParameters (
        parameters: Utils.Dictionary<Parser.IParameter>
    ): Array<TSD.ParameterDeclaration> {

        let declaration = undefined as (TSD.ParameterDeclaration|undefined),
            parameter = undefined as (Parser.IParameter|undefined);

        return Object
            .keys(parameters)
            .map(name => {

                declaration = new TSD.ParameterDeclaration(name);
                parameter = parameters[name];

                if (parameter.defaultValue) {
                    declaration.defaultValue = parameter.defaultValue;
                }

                if (parameter.description) {
                    declaration.description = parameter.description;
                }

                if (parameter.isVariable) {
                    declaration.isVariable = true;
                }
                else if (parameter.isOptional) {
                    declaration.isOptional = true;
                }

                if (parameter.types) {
                    declaration.types.push(...parameter.types);
                }

                return declaration;
            });
    }

    private generateProperty (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.PropertyDeclaration|undefined) {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.PropertyDeclaration(doclet.name);

        if (doclet.isGlobal) {
            targetDeclaration = this._globals;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.PropertyDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.isOptional) {
            declaration.isOptional = true;
        }

        if (doclet.isPrivate) {
            declaration.isPrivate = true;
        }

        if (doclet.isStatic) {
            declaration.isStatic = true;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.types) {
            let mergedTypes = Utils.uniqueArray(
                declaration.types,
                doclet.types
            );
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        return declaration;
    }

    private generateType (
        sourceNode: Parser.INode,
        targetDeclaration: TSD.IDeclaration
    ): (TSD.TypeDeclaration|undefined) {

        let doclet = Generator.getNormalizedDoclet(sourceNode),
            declaration = new TSD.TypeDeclaration(doclet.name);

        if (doclet.isGlobal) {
            // global helper types are always limited to the main module scope
            targetDeclaration = this._globals;
        }
        else if (targetDeclaration.kind !== this._namespace.kind) {
            targetDeclaration = this._namespace;
        }

        let existingChild = targetDeclaration.getChildren(declaration.name)[0];

        if (existingChild instanceof TSD.TypeDeclaration) {
            declaration = existingChild;
        }

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.see) {
            declaration.see.push(...doclet.see);
        }

        if (doclet.types) {
            let mergedTypes = Utils.uniqueArray(
                declaration.types,
                doclet.types.filter(type =>
                    !sourceNode.children ||
                    type !== type.toLowerCase()
                )
            );
            declaration.types.length = 0;
            declaration.types.push(...mergedTypes);
        }

        if (!declaration.parent) {
            targetDeclaration.addChildren(declaration);
        }

        if (sourceNode.children) {
            this.generateChildren(sourceNode.children, declaration);
        }

        return declaration;
    }

    private isMainMember (
        name: string, baseDeclaration: TSD.IDeclaration = this._namespace
    ): boolean {

        if (!name.startsWith('Highcharts.')) {
            name = ('Highcharts.' + name);
        }

        if (!Generator.OPTION_TYPE.test(name)) {
            return false;
        }

        let isMainType = TSD.IDeclaration
            .extractTypeNames(...baseDeclaration.types)
            .filter(type => !Utils.isCoreType(type))
            .some(type => (type === name));
        
        if (!isMainType &&
            baseDeclaration instanceof TSD.IExtendedDeclaration
        ) {
            isMainType = baseDeclaration
                .getParameters()
                .map(param => TSD.IDeclaration.extractTypeNames(
                    ...param.types
                ))
                .some(types => types.indexOf(name) > -1);
        }

        if (!isMainType) {
            isMainType = baseDeclaration
                .getChildren()
                .some(child => this.isMainMember(name, child))
        };

        return isMainType;
    }

    public toString (): string {
        return this._namespace.toString();
    }
}
