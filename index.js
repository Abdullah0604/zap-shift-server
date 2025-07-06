const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.aq5ggi6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const varifyFBToken = async (req, res, next) => {
      const authHeaders = req.headers.authorization;
      console.log("headers from middleware", authHeaders);
      if (!authHeaders || !authHeaders.startsWith("Bearer "))
        return res.status(401).send({ message: "unauthorized" });

      const token = authHeaders.split(" ")[1];
      if (!token) return res.status(401).send({ message: "unauthorized" });

      // varify token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded; // contains email, uid, etc.
        next();
      } catch (error) {
        return res.status(403).json({ error: "Invalid or expired token" });
      }
      console.log(token);
    };

    const verifyEmail = async (req, res, next) => {
      if (req.decoded.email !== req.query.email) {
        return res.status(403).send("Forbidden");
      }
      next();
    };

    const db = client.db("parcelDelivery");
    const parcelsCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");
    /*
     * 📦 Parcel Delivery API
     *
     * This backend server is being developed incrementally.
     * Each API route is added based on feature needs during development.
     *
     * Instead of writing all endpoints at once, I am adding them one by one
     * as each specific functionality is implemented (e.g., after Send Parcel form, then Delete, etc).
     *
     * This approach ensures clarity, simplicity, and avoids unnecessary code.
     *
     */

    // ✅ GET all parcels
    app.get("/parcels", async (req, res) => {
      try {
        const parcels = await parcelsCollection.find().toArray();
        console.log("is it hited?");
        res.status(200).json(parcels);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch parcels" });
      }
    });

    // ✅ POST new parcel (Send Parcel)
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelsCollection.insertOne(parcel);
        res.status(201).send(result);
      } catch (err) {
        res.status(500).json({ error: "Failed to store parcel" });
      }
    });

    // ✅ GET Fetch all parcels created by the given user email, sorted by creation time (newest first)
    app.get("/parcels/user", varifyFBToken, verifyEmail, async (req, res) => {
      const email = req.query.email;
      console.log(req.decoded);

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      try {
        const parcels = await db
          .collection("parcels")
          .find({ createdBy: email })
          .sort({ createdAt: -1 }) // newest first
          .toArray();

        res.json(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).json({ error: "Failed to fetch parcels" });
      }
    });

    // ✅ DELETE a parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelsCollection.deleteOne(query);

      res.send(result);
    });

    // ✅ Get a single parcel by parcelId
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      console.log("parcel id sing", id);
      try {
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(id),
        });

        res.status(200).send(parcel);
      } catch (err) {
        console.error("❌ Error fetching parcel by ID:", err);
        res.status(500).json({ error: "Failed to fetch parcel" });
      }
    });

    // ✅ stripe payment gateway api Create a payment intent
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amountInCents, parcelId } = req.body;

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
          // Add any additional options here
        });

        // Send the client secret to the client
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ✅ save payments history and update unpaid to paid
    app.post("/parcels/payment", async (req, res) => {
      const { amount, transactionId, user_email, parcelId, paymentMehtod } =
        req.body; // expect: { amount, transactionId, user_email }

      if (!ObjectId.isValid(parcelId)) {
        return res.status(400).json({ error: "Invalid parcel ID" });
      }

      try {
        // Step 1: Update parcel's payment status
        const updateResult = await db.collection("parcels").updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .json({ error: "Parcel not found or already paid" });
        }

        // Step 2: Create payment record
        const paymentRecord = {
          parcelId,
          user_email,
          transactionId,
          amount,
          paymentMehtod,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentInsert = await paymentsCollection.insertOne(paymentRecord);

        res.status(200).send({
          message: "Payment processed successfully",
          insertedId: paymentInsert.insertedId,
        });
      } catch (err) {
        console.error("❌ Payment error:", err);
        res.status(500).json({ error: "Payment processing failed" });
      }
    });

    // ✅ get user's payment by email
    app.get("/payments", varifyFBToken, verifyEmail, async (req, res) => {
      const email = req.query.email;

      const filter = email ? { user_email: email } : {};
      try {
        const payments = await paymentsCollection
          .find(filter)
          .sort({ paid_at: -1 }) // ✅ newest first
          .toArray();

        res.status(200).send(payments);
      } catch (err) {
        console.error("❌ Failed to get payment history:", err);
        res.status(500).json({ error: "Failed to fetch payment history" });
      }
    });

    // ✅ Save new user (or skip if already exists)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      try {
        // 🔍 Check if user already exists
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          console.log(user);
          const updatedLastLogin = await usersCollection.updateOne(
            { email: email },
            { $set: { last_log_in: user.last_log_in } }
          );
          return res.status(200).json({
            message: "User already exists. But updated last login time",
            updatedLastLogin,
          });
        }

        const result = await usersCollection.insertOne(user);

        res.status(201).json({
          message: "User registered successfully",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("❌ Error creating user:", err);
        res.status(500).json({ error: "Failed to register user" });
      }
    });

    // ✅ save riders data
    app.post("/riders", async (req, res) => {
      const data = req.body;
      const result = await ridersCollection.insertOne(data);
      res.send(result);
    });

    // ✅ get all pending riders data
    app.get("/riders/pending", async (req, res) => {
      const query = req.query.status;
      const pendingRiders = await ridersCollection
        .find({ status: query }) // filter pending riders
        .sort({ createdAt: -1 }) // newest first
        .toArray();

      res.send(pendingRiders);
    });

    // ✅ update riders status
    app.patch("/riders/:id/status", async (req, res) => {
      const riderId = req.params.id;
      const { action } = req.body; // expect "approve" or "reject"
      const updateData = {
        status: action === "approved" ? "active" : "rejected",
      };
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(riderId) },
        { $set: updateData }
      );
      res.send(result);
    });

    // ✅ get all active riders data
    app.get("/riders/active", async (req, res) => {
      const query = req.query.status;
      const pendingRiders = await ridersCollection
        .find({ status: query }) // filter pending riders
        .sort({ createdAt: -1 }) // newest first
        .toArray();

      res.send(pendingRiders);
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Routes

// Root Route
app.get("/", (req, res) => {
  res.send("Parcel Delivery Server is Running 🚚");
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
