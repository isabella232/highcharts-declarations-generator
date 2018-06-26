/* *
 * 
 *  Copyright (c) Highsoft AS. All rights reserved.
 * 
 * */

import * as parser from './NamespaceParser';
import * as tsd from './TypeScriptDeclarations';
import * as utils from './Utilities';



export function saveIntoFiles(
    filesDictionary: utils.Dictionary<parser.INode>,
    optionsDeclarations: tsd.IDeclaration
): Promise<void> {

    let promises = [] as Array<Promise<void>>;

    Object
        .keys(filesDictionary)
        .forEach(filePath => {

            let dtsFilePath = utils.getDeclarationFilePath(filePath),
                generator = new Generator(filesDictionary[filePath]);

            Generator.mergeDeclaration(generator.global, optionsDeclarations);

            promises.push(
                utils
                    .save(dtsFilePath, generator.toString())
                    .then(() => console.log('Saved ' + dtsFilePath))
            );
        })

    return Promise
        .all(promises)
        .then(() => undefined);
}



class Generator extends Object {

    /* *
     *
     *  Static Functions
     *
     * */

    private static getDoclet(sourceNode: parser.INode): parser.IDoclet {

        let doclet = (sourceNode.doclet || {
            description: '',
            kind: 'global',
            name: ''
        });

        let description = (doclet.description || '').trim(),
            nameParts = (doclet.name || '').split('.');

        description = description.replace(
            /\{@link\W+([^\}\|]+)[\S\s]*\}/gm, '$1'
        );
        description = description.replace(
            /\s+\-\s+/gm, '\n\n- '
        );

        doclet.description = description;
        doclet.name = nameParts[nameParts.length - 1].trim();
        
        if (doclet.types) {
            doclet.types = doclet.types.map(utils.typeMapper);
        }

        return doclet;
    }

    public static mergeDeclaration(
        targetDeclaration: tsd.IDeclaration,
        sourceDeclaration: tsd.IDeclaration
    ) {
        console.log('mergeDeclaration', targetDeclaration.name, sourceDeclaration.name);
        if (!targetDeclaration.description) {
            targetDeclaration.description = sourceDeclaration.description;
        }

        utils.mergeArray(targetDeclaration.types, sourceDeclaration.types)

        let sourceChild = undefined as (tsd.IDeclaration|undefined),
            sourceChildrenNames = sourceDeclaration.getChildrenNames(),
            targetChild = undefined as (tsd.IDeclaration|undefined),
            targetChildrenNames = targetDeclaration.getChildrenNames();

        sourceChildrenNames.forEach(childName => {

            sourceChild = sourceDeclaration.removeChild(childName);

            if (!sourceChild) {
                return;
            }

            targetChild = targetDeclaration.getChild(childName);

            if (targetChild) {
                Generator.mergeDeclaration(targetChild, sourceChild);
            } else {
                console.log('addChild', sourceChild.name, sourceChild);
                targetDeclaration.addChildren(sourceChild);
            }
        });
    }

    /* *
     *
     *  Constructor
     *
     * */

    public constructor (node: parser.INode) {

        super();

        this._global = new tsd.GlobalDeclaration();

        this.generate(node);
    }

    /* *
     *
     *  Properties
     *
     * */

    public get global(): tsd.GlobalDeclaration {
        return this._global;
    }
    private _global: tsd.GlobalDeclaration;

    /* *
     *
     *  Functions
     *
     * */

    private generate(
        sourceNode: parser.INode,
        targetDeclaration: tsd.IDeclaration = this._global
    ) {

        let childDeclaration = undefined as (tsd.IDeclaration|undefined),
            kind = (sourceNode.doclet && sourceNode.doclet.kind || ''),
            name = (sourceNode.doclet && sourceNode.doclet.name || '');

        // console.log('Generate ' + kind + ' declaration for ' + name);

        switch (kind) {
            default:
                console.error(
                    'Unknown kind: ' + kind,
                    sourceNode
                );
                break;
            case 'class':
                childDeclaration = this.generateClass(sourceNode);
                break;
            case 'function':
                if (sourceNode.children) {
                    childDeclaration = this.generateInterface(sourceNode);
                    childDeclaration.addChildren(
                        new tsd.PropertyDeclaration('()')
                    );
                } else {
                    childDeclaration = this.generateFunction(sourceNode);
                }
                break;
            case 'global':
                this._global = this.generateGlobal(sourceNode);
                break;
            case 'namespace':
                childDeclaration = this.generateNamespace(sourceNode);
                break;
            case 'member':
                childDeclaration = this.generateProperty(sourceNode);
                break;
            case 'typedef':
                if (sourceNode.children) {
                    this._global.addChildren(
                        this.generateInterface(sourceNode)
                    );
                } else {
                    this._global.addChildren(
                        this.generateType(sourceNode)
                    );
                }
                break;
        }

        if (childDeclaration) {
            targetDeclaration.addChildren(childDeclaration);
        }
    }

    private generateChildren (
        nodeChildren: utils.Dictionary<parser.INode>,
        targetDeclaration: tsd.IDeclaration
    ) {

        Object
            .keys(nodeChildren)
            .forEach(childName => this
                .generate(nodeChildren[childName], targetDeclaration)
            );
    }

    private generateClass (node: parser.INode): tsd.ClassDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.ClassDeclaration(doclet.name);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.parameters) {
            declaration.setParameters(
                ...this.generateParameters(doclet.parameters)
            );
        }

        if (doclet.types) {
            declaration.types.push(...doclet.types.map(utils.typeMapper));
        }

        if (node.children) {
            this.generateChildren(node.children, declaration);
        }

        return declaration;
    }

    private generateFunction (node: parser.INode): tsd.FunctionDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.FunctionDeclaration(doclet.name);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.isPrivate) {
            declaration.isPrivate = true;
        }

        if (doclet.isStatic) {
            declaration.isStatic = true;
        }

        if (doclet.parameters) {
            declaration.setParameters(
                ...this.generateParameters(doclet.parameters)
            );
        }

        if (doclet.types) {
            declaration.types.push(...doclet.types.map(utils.typeMapper));
        }

        if (node.children) {
            this.generateChildren(node.children, declaration);
        }

        return declaration;
    }

    private generateGlobal (node: parser.INode): tsd.GlobalDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = this._global;
        
        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (node.children) {
            this.generateChildren(node.children, declaration);
        }

        return declaration;
    }

    private generateInterface (node: parser.INode): tsd.InterfaceDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.InterfaceDeclaration(doclet.name);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.types) {
            declaration.types.push(...doclet.types.map(utils.typeMapper));
        }

        if (node.children) {
            this.generateChildren(node.children, declaration);
        }

        return declaration;
    }

    private generateNamespace (node: parser.INode): tsd.NamespaceDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.NamespaceDeclaration(doclet.name);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (node.children) {
            this.generateChildren(node.children, declaration);
        }

        return declaration;
    }

    private generateParameters (
        parameters: utils.Dictionary<parser.IParameter>
    ): Array<tsd.ParameterDeclaration> {

        let declaration = undefined as (tsd.ParameterDeclaration|undefined),
            parameter = undefined as (parser.IParameter|undefined);

        return Object
            .keys(parameters)
            .map(name => {

                declaration = new tsd.ParameterDeclaration(name);
                parameter = parameters[name];

                if (parameter.description) {
                    declaration.description = parameter.description;
                }

                if (parameter.types) {
                    declaration.types.push(...parameter.types.map(utils.typeMapper));
                }

                return declaration;
            });
    }

    private generateProperty (node: parser.INode): tsd.PropertyDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.PropertyDeclaration(doclet.name);

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

        if (doclet.types) {
            declaration.types.push(...doclet.types.map(utils.typeMapper));
        }

        return declaration;
    }

    private generateType (node: parser.INode): tsd.TypeDeclaration {

        let doclet = Generator.getDoclet(node),
            declaration = new tsd.TypeDeclaration(doclet.name);

        if (doclet.description) {
            declaration.description = doclet.description;
        }

        if (doclet.types) {
            declaration.types.push(...doclet.types.map(utils.typeMapper));
        }

        return declaration;
    }

    public toString(): string {

        return this._global.toString();
    }
}
