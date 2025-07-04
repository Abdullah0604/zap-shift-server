const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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

    const db = client.db("parcelDelivery");
    const parcelsCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");
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
    app.get("/parcels/user", async (req, res) => {
      const email = req.query.email;
      console.log(email);
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

    const { ObjectId } = require("mongodb"); // ✅ make sure it's imported at top

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
    app.patch("/parcels/payment", async (req, res) => {
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

        res.status(200).json({
          message: "Payment processed successfully",
          paymentId: paymentInsert.insertedId,
        });
      } catch (err) {
        console.error("❌ Payment error:", err);
        res.status(500).json({ error: "Payment processing failed" });
      }
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
