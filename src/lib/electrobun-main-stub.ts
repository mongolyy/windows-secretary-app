// ブラウザ用の型チェックで electrobun を解決するための代替。デスクトップの型は devkit を見る。

export type RPCSchema<I> = I extends { requests?: infer Requests; messages?: infer Messages }
  ? {
      requests: undefined extends Requests ? Record<string, never> : Requests;
      messages: undefined extends Messages ? Record<string, never> : Messages;
    }
  : { requests: Record<string, never>; messages: Record<string, never> };
