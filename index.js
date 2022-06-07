const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { decode } = require("jsonwebtoken");
const res = require("express/lib/response");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

app.use(cors({ origin: "https://woodpecker-b622f.web.app" }));
app.use(express.json());

const verifyToken = (req, res, next) => {
  const authorization = req.headers.authentication;
  if (!authorization) {
    return res.status(401).send({
      message: " Unauthorized access",
    });
  }
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, function (err, decoded) {
    if (err) {
      res.status(403).send({
        message: "Forbidden access",
      });
    }
    req.decoded = decoded;
  });
  next();
};

const uri = `mongodb+srv://${process.env.DATABASE_NAME}:${process.env.DATABASE_PASS}@cluster0.sv0zl.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
async function run() {
  try {
    await client.connect();
    const toolsCollection = client.db("woodpecker-data").collection("tools");
    const userCollection = client.db("woodpecker-data").collection("users");
    const orderCollection = client.db("woodpecker-data").collection("orders");
    const paymentCollection = client
      .db("woodpecker-data")
      .collection("payment");
    const commentCollection = client
      .db("woodpecker-data")
      .collection("comments");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    };
    //stripe
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { totalPrice } = req.body;
      const amount = totalPrice * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    ///check admin
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    //
    app.put("/user/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: decodedEmail,
      });
      if (requesterAccount.role === "admin") {
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);

        res.send(result);
      } else res.status(403).send({ message: "Forbidden access" });
    });
    //set a user
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "720h",
      });

      res.send({ result, token });
    });
    // get users
    app.get("/users", verifyToken, async (req, res) => {
      const query = {};
      const users = await userCollection.find(query).toArray();
      res.send(users);
    });

    //get a tool by id
    app.get("/tools/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await toolsCollection.findOne(query);
      res.send(result);
    });
    // get all the tools
    app.get("/tools", async (req, res) => {
      const query = {};
      const result = toolsCollection.find(query);
      const tools = await result.toArray();
      res.send(tools);
    });
    //adding tools

    app.post("/tool", verifyToken, verifyAdmin, async (req, res) => {
      const tool = req.body;
      const options = { upsert: true };
      const result = await toolsCollection.insertOne(tool, options);
      res.send(result);
    });
    //adding orders
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });
    //get orders
    app.get("/orders", verifyToken, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded?.email;

      if (decodedEmail === email) {
        const query = { userEmail: email };
        const cursor = orderCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } else {
        return res.status(403).send({
          message: "Forbidden access",
        });
      }
    });
    //get specific order
    app.get("/order/:id", verifyToken, async (req, res) => {
      const orderId = req.params.id;
      const query = {
        _id: ObjectId(orderId),
      };
      const order = await orderCollection.findOne(query);
      res.send(order);
    });
    //delete
    app.delete("/order/:id", verifyToken, async (req, res) => {
      const orderId = req.params.id;
      const filter = { _id: ObjectId(orderId) };
      const result = await orderCollection.deleteOne(filter);
      res.send(result);
    });
    ///update order
    app.patch("/order/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = {
        _id: ObjectId(id),
      };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updatedOrder = await orderCollection.updateOne(filter, updateDoc);
      const updatedPayment = await paymentCollection.insertOne(payment);
      res.send(updateDoc);
    });
    //put comment
    app.put("/comments", async (req, res) => {
      const comment = req.body;
      const filter = { email: comment.email };
      const options = { upsert: true };
      const updateDoc = {
        $set: comment,
      };
      const result = await commentCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });
    app.get("/review", async (req, res) => {
      const result = commentCollection.find();
      const review = await result.toArray();
      res.send(review);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello");
});
app.listen(port, () => {
  console.log("server running on 5000");
});
