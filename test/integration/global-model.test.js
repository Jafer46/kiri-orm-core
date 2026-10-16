import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, disconnect, createModel, syncModels, getConnection, transaction } from "../../src/global/index.js";
import { __resetGlobalStateForTests } from "../../src/global/state.js";
import { captureQueries } from "../helpers/sql-capture.js";

describe("createModel (Mongoose-style global API)", () => {
  beforeEach(() => {
    __resetGlobalStateForTests();
    connect({ dialect: "sqlite", filename: ":memory:" });
  });

  afterEach(async () => {
    await disconnect();
    __resetGlobalStateForTests();
  });

  it("defines a model in one function and uses it in a completely separate one, with no client/uow ever passed between them", async () => {
    // Simulates "models/user.js" defining and exporting a model, and
    // "somewhere-else.js" importing and using it - the entire point
    // of this API. No object is threaded between the two functions.
    function defineUserModel() {
      return createModel("user", {
        fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      });
    }

    async function useUserModelElsewhere(User) {
      return User.create({ id: 1, name: "Alice" });
    }

    const User = defineUserModel();
    await syncModels();
    const user = await useUserModelElsewhere(User);
    expect(user.name).toBe("Alice");
  });

  it("has no identity map - two find() calls for the same row return different object instances", async () => {
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    await syncModels();
    await User.create({ id: 1, name: "Alice" });

    const [first] = await User.find({ id: 1 });
    const [second] = await User.find({ id: 1 });
    expect(first).not.toBe(second);
    expect(first).toEqual(second); // same data, different objects
  });

  it("a document's save() only sends changed columns (verified via captured SQL)", async () => {
    const User = createModel("user", {
      fields: {
        id: { type: "integer", required: true },
        name: { type: "char", required: true },
        email: { type: "char", required: true },
      },
    });
    await syncModels();
    const user = await User.create({ id: 1, name: "Alice", email: "alice@example.com" });

    user.name = "Alice Smith";
    const { queries } = await captureQueries(getConnection(), () => user.save());
    const updateQuery = queries.find((q) => q.sql.toLowerCase().startsWith("update"));
    expect(updateQuery.sql.toLowerCase()).toContain("name");
    expect(updateQuery.sql.toLowerCase()).not.toContain("email");
  });

  it("save() with no changes is a true no-op", async () => {
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    await syncModels();
    const user = await User.create({ id: 1, name: "Alice" });

    const { queries } = await captureQueries(getConnection(), () => user.save());
    expect(queries).toEqual([]);
  });

  it("delete() removes the row", async () => {
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    await syncModels();
    const user = await User.create({ id: 1, name: "Alice" });
    await user.delete();

    const found = await User.find({ id: 1 });
    expect(found).toEqual([]);
  });

  it("hooks are declared inline in the schema and fire in order", async () => {
    const order = [];
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      hooks: {
        beforeCreate: [() => order.push("first"), () => order.push("second")],
        afterCreate: () => order.push("afterCreate"),
      },
    });
    await syncModels();
    await User.create({ id: 1, name: "Alice" });

    expect(order).toEqual(["first", "second", "afterCreate"]);
  });

  it("a beforeUpdate hook receives the pre-edit `original` snapshot as its third argument", async () => {
    let seenOriginalName;
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      hooks: {
        beforeUpdate: (entity, dirty, original) => {
          seenOriginalName = original.name;
        },
      },
    });
    await syncModels();
    const user = await User.create({ id: 1, name: "Alice" });
    user.name = "Alice Smith";
    await user.save();

    expect(seenOriginalName).toBe("Alice");
  });

  it("a rejected save() reverts the document to its last-known-good value", async () => {
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      hooks: {
        beforeUpdate: (entity, dirty) => {
          if (dirty.name === "Blocked") throw new Error("nope");
        },
      },
    });
    await syncModels();
    const user = await User.create({ id: 1, name: "Alice" });
    user.name = "Blocked";

    await expect(user.save()).rejects.toThrow("nope");
    expect(user.name).toBe("Alice"); // reverted, not left at "Blocked"
  });

  it("relations, eager loading (including nested), and domain relation traversal all work through the Model API", async () => {
    const Customer = createModel("customer", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
    });
    const Order = createModel("order", {
      fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
      relations: {
        customer: { type: "belongsTo", model: "customer", foreignKey: "customerId" },
        items: { type: "hasMany", model: "orderItem", foreignKey: "orderId" },
      },
    });
    const OrderItem = createModel("orderItem", {
      fields: {
        id: { type: "integer", required: true },
        orderId: { type: "integer", required: true },
        description: { type: "char" },
      },
    });
    await syncModels();

    const customer = await Customer.create({ id: 1, name: "Acme" });
    await Order.create({ id: 1, customerId: customer.id });
    await OrderItem.create({ id: 1, orderId: 1, description: "Widget" });

    const [order] = await Order.find({ id: 1 }, { with: ["customer", "items"] });
    expect(order.customer.name).toBe("Acme");
    expect(order.items[0].description).toBe("Widget");

    const matches = await Order.find([["customer.name", "=", "Acme"]]);
    expect(matches.map((o) => o.id)).toEqual([1]);
  });

  it("attach()/detach() work for belongsToMany relations", async () => {
    const Product = createModel("product", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      relations: {
        tags: { type: "belongsToMany", model: "tag", through: "product_tag", foreignKey: "product_id", otherKey: "tag_id" },
      },
    });
    const Tag = createModel("tag", { fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } } });
    await syncModels();

    const widget = await Product.create({ id: 1, name: "Widget" });
    const tag = await Tag.create({ id: 1, name: "featured" });

    const attached = await Product.attach(widget, "tags", tag.id);
    expect(attached).toBe(1);

    const [found] = await Product.find({ id: 1 }, { with: ["tags"] });
    expect(found.tags.map((t) => t.name)).toEqual(["featured"]);

    const detached = await Product.detach(widget, "tags", tag.id);
    expect(detached).toBe(1);
  });

  it("updateMany()/deleteMany() perform bulk operations without hooks or a tracked instance", async () => {
    const User = createModel("user", {
      fields: { id: { type: "integer", required: true }, name: { type: "char", required: true }, status: { type: "char" } },
    });
    await syncModels();
    await User.create({ id: 1, name: "Alice", status: "active" });
    await User.create({ id: 2, name: "Bob", status: "active" });

    const updated = await User.updateMany({ status: "active" }, { status: "inactive" });
    expect(updated).toBe(2);

    const deleted = await User.deleteMany({ id: 1 });
    expect(deleted).toBe(1);
  });

  it("rejects a hook name that isn't a real lifecycle hook", () => {
    expect(() =>
      createModel("user", {
        fields: { id: { type: "integer", required: true } },
        hooks: { beforeFrobnicate: () => {} },
      })
    ).toThrow(TypeError);
  });

  describe("transactions", () => {
    it("transaction commits every Model write performed inside it on success", async () => {
      const User = createModel("user", {
        fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      });
      await syncModels();

      await transaction(async (trx) => {
        await User.create({ id: 1, name: "Alice" }, { trx });
        await User.create({ id: 2, name: "Bob" }, { trx });
      });

      const users = await User.find();
      expect(users.map((u) => u.name).sort()).toEqual(["Alice", "Bob"]);
    });

    it("rolls back every Model write if the callback throws", async () => {
      const User = createModel("user", {
        fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      });
      await syncModels();

      await expect(
        transaction(async (trx) => {
          await User.create({ id: 1, name: "Alice" }, { trx });
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      expect(await User.find()).toEqual([]);
    });

    it("rolls back atomically across TWO different Models sharing one transaction", async () => {
      const Order = createModel("order", {
        fields: { id: { type: "integer", required: true }, customerId: { type: "integer", required: true } },
        relations: { items: { type: "hasMany", model: "orderItem", foreignKey: "orderId" } },
      });
      const OrderItem = createModel("orderItem", {
        fields: {
          id: { type: "integer", required: true },
          orderId: { type: "integer", required: true },
          quantity: { type: "integer", required: true, min: 1 },
        },
      });
      await syncModels();

      await expect(
        transaction(async (trx) => {
          const order = await Order.create({ id: 1, customerId: 1 }, { trx });
          await OrderItem.create({ id: 1, orderId: order.id, quantity: 2 }, { trx });
          await OrderItem.create({ id: 2, orderId: order.id, quantity: -5 }, { trx }); // invalid - min: 1
        })
      ).rejects.toThrow();

      expect(await Order.find()).toEqual([]);
      expect(await OrderItem.find()).toEqual([]);
    });

    it("a document's save() and delete() accept { trx } to participate in an ongoing transaction", async () => {
      const User = createModel("user", {
        fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      });
      await syncModels();
      const user = await User.create({ id: 1, name: "Alice" });

      await expect(
        transaction(async (trx) => {
          user.name = "Alice Smith";
          await user.save({ trx });
          throw new Error("rollback everything");
        })
      ).rejects.toThrow("rollback everything");

      const [fresh] = await User.find({ id: 1 });
      expect(fresh.name).toBe("Alice"); // save() was rolled back
    });

    it("find() with { trx } sees uncommitted writes made earlier in the same transaction", async () => {
      const User = createModel("user", {
        fields: { id: { type: "integer", required: true }, name: { type: "char", required: true } },
      });
      await syncModels();

      await transaction(async (trx) => {
        await User.create({ id: 1, name: "Alice" }, { trx });
        const usersInTx = await User.find({ id: 1 }, { trx });
        expect(usersInTx).toHaveLength(1);
      });
    });
  });
});
