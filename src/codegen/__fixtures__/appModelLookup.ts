/**
 * Compile-time contract for the generated model-name map. `getModel` is the
 * typo-safe path for statically known names; `getModelOrThrow` deliberately
 * accepts a runtime string and removes the `false` branch.
 */
import type { AppModel, IApp } from '../../server.ts';

type ArticleModel = AppModel & {
  readonly modelName: 'Article';
  findPublished(): Promise<unknown[]>;
};

type CommentModel = AppModel & {
  readonly modelName: 'Comment';
  findRecent(): Promise<unknown[]>;
};

type ApplicationUserModel = AppModel & {
  readonly modelName: 'User';
  findByHandle(handle: string): Promise<unknown>;
};

declare module '../../server.ts' {
  interface AppModelTypes {
    Article: ArticleModel;
    Comment: CommentModel;
    User: ApplicationUserModel;
  }
}

declare const app: IApp;
declare const runtimeName: string;
declare const generatedName: 'Article' | 'Comment';

const Article = app.getModel('Article');
const articleName: 'Article' = Article.modelName;
void articleName;
void Article.findPublished();

const RequiredArticle = app.getModelOrThrow('Article');
void RequiredArticle.findPublished();

const generatedModel: ArticleModel | CommentModel = app.getModel(generatedName);
void generatedModel;

const requiredGeneratedModel: ArticleModel | CommentModel =
  app.getModelOrThrow(generatedName);
void requiredGeneratedModel;

// A generated replacement of a framework-owned name must win over the broad
// framework fallback and must not regain its `false` branch.
const ApplicationUser: ApplicationUserModel = app.getModel('User');
void ApplicationUser.findByHandle('reader');

const runtimeModel: AppModel = app.getModelOrThrow(runtimeName);
void runtimeModel;

// A model resolved by runtime name stays queryable: the overloaded finders must
// resolve, not just the single-signature writers.
void runtimeModel.findOne({});
void runtimeModel.find({});
void runtimeModel.findById('x');
void runtimeModel.countDocuments({});
// @ts-expect-error the runtime-name model is a real model type, not `any`
void runtimeModel.notAMongooseMethod;

const frameworkModel: AppModel | false = app.getModel('Lock');
void frameworkModel;

// @ts-expect-error misspelled literals must not fall through to a string overload
app.getModel('Artcle');

// @ts-expect-error runtime names must choose the explicit throwing API
app.getModel(runtimeName);
