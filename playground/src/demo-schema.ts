import {
  BasicDataModel,
  Fixture,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";

const POSTS_TABLE = "posts";
const COMMENTS_TABLE = "comments";
const TAGS_TABLE = "tags";

const DEMO_TAGS = [{ name: "intro" }, { name: "follow-up" }, { name: "rant" }];

const DEMO_POSTS = [
  { title: "First post", author: "alice", views: 12, tag_ids: [] as string[] },
  { title: "Second post", author: "bob", views: 47, tag_ids: [] as string[] },
  { title: "Third post", author: "alice", views: 3, tag_ids: [] as string[] },
];

const DEMO_COMMENTS = [
  { post: "first-post", author: "carol", body: "Nice!" },
  { post: "first-post", author: "dan", body: "Agreed." },
];

@RegisterTable(TAGS_TABLE, "demo")
@Fixture(() => DEMO_TAGS.map((row) => TagModel.fromPlainData(row)))
export class Tag extends Table {
  declare _id: string;
  @Index() declare name: string;
}

export class TagModel extends BasicDataModel(Tag, TAGS_TABLE) {}

@RegisterTable(POSTS_TABLE, "demo")
@Fixture(() => DEMO_POSTS.map((row) => PostModel.fromPlainData(row)))
export class Post extends Table {
  declare _id: string;
  @Index() declare title: string;
  @Index() declare author: string;
  declare views: number;
  @Relation({ to: () => Tag, many: true }) declare tag_ids: string[];
}

export class PostModel extends BasicDataModel(Post, POSTS_TABLE) {}

@RegisterTable(COMMENTS_TABLE, "demo")
@Fixture(() => DEMO_COMMENTS.map((row) => CommentModel.fromPlainData(row)))
export class Comment extends Table {
  declare _id: string;
  @Index() @Relation({ to: () => Post }) declare post: string;
  declare author: string;
  declare body: string;
}

export class CommentModel extends BasicDataModel(Comment, COMMENTS_TABLE) {}
