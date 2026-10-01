/**
 * AST du DSL. Structure de données pure (sérialisable en JSON) : jamais de
 * fonction, jamais de référence à du code exécutable.
 */

export interface NodeBase {
  /** Décalage de début dans la source. */
  readonly start: number;
  /** Décalage de fin (exclu). */
  readonly end: number;
  /** Hauteur du sous-arbre (1 pour une feuille). */
  readonly height: number;
}

export interface NumberNode extends NodeBase {
  readonly t: 'number';
  /** Littéral décimal tel qu'écrit (ex. « 0.4 »), converti en Decimal à l'évaluation. */
  readonly value: string;
}
export interface StringNode extends NodeBase {
  readonly t: 'string';
  readonly value: string;
}
export interface BooleanNode extends NodeBase {
  readonly t: 'boolean';
  readonly value: boolean;
}
export interface NullNode extends NodeBase {
  readonly t: 'null';
}
export interface NameNode extends NodeBase {
  readonly t: 'name';
  readonly name: string;
}
export interface MemberNode extends NodeBase {
  readonly t: 'member';
  readonly object: Node;
  readonly property: string;
  /** Position du nom du champ (pour les messages). */
  readonly propertyStart: number;
}
export interface CallNode extends NodeBase {
  readonly t: 'call';
  readonly callee: string;
  readonly calleeEnd: number;
  readonly args: readonly Node[];
}
export type UnaryOp = '-' | '!';
export interface UnaryNode extends NodeBase {
  readonly t: 'unary';
  readonly op: UnaryOp;
  readonly operand: Node;
}
export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
export interface BinaryNode extends NodeBase {
  readonly t: 'binary';
  readonly op: BinaryOp;
  readonly left: Node;
  readonly right: Node;
  /** Position de l'opérateur (pour les messages). */
  readonly opStart: number;
}
export interface ListNode extends NodeBase {
  readonly t: 'list';
  readonly items: readonly Node[];
}
/**
 * Lambda `x => corps` : n'existe QUE comme 2e argument de map/filter/any/all.
 * Ce n'est pas une valeur : elle ne peut être ni stockée, ni passée, ni appelée,
 * donc aucune récursion n'est possible.
 */
export interface LambdaNode extends NodeBase {
  readonly t: 'lambda';
  readonly param: string;
  readonly paramStart: number;
  readonly body: Node;
}

export type Node =
  | NumberNode
  | StringNode
  | BooleanNode
  | NullNode
  | NameNode
  | MemberNode
  | CallNode
  | UnaryNode
  | BinaryNode
  | ListNode
  | LambdaNode;
