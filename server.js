const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const util = require("util");
const unlinkFile = util.promisify(fs.unlink);

// Google api
const { google } = require("googleapis");

const KEY_PATH = path.join(__dirname, "api-key.json");

// authenticate
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

function checkFileType(file, cb) {
  const filetypes = /jpeg|png|jpg|gif/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb("Please upload images only");
  }
}

const upload = multer({
  storage: storage,
  limits: { fileSize: 2000000 },
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
}).any();

const port = process.env.PORT || 3000;

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// For setting template engine
app.set("view engine", "ejs");

// Access
app.use(express.static("public"));

// Access views folder for images/favicon
app.use(express.static("views"));

app.get("/", async (req, res) => {
  try {
    // Fetch images from Google Drive
    const response = await drive.files.list({
      q: "'1ZPREpiTanEQz6ZRcmT9NCWhhw6eo2Huv' in parents and mimeType contains 'image/'",
      fields: "files(id, name)",
    });

    // Map the data to include the file ID and public URL
    const images = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      url: `https://drive.google.com/uc?export=view&id=${file.id}`, // Public URL of the image
    }));

    // Render the 'index' template and send the images data
    res.render("index", { images: images });
  } catch (error) {
    console.error("Error fetching images from Google Drive:", error);
    res.status(500).send("Failed to load images");
  }
});

app.get("/image/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    res.setHeader("Content-Type", "image/jpg"); // Adjust based on your images' format
    response.data.pipe(res);
  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).send("Image not found");
  }
});

app.post("/upload", async (req, res) => {
  upload(req, res, async (err) => {
    if (!err && req.files.length > 0) {
      try {
        const file = req.files[0];
        const filePath = file.path;
        const fileName = file.originalname;

        // Upload the file to Google Drive
        const response = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: ["1ZPREpiTanEQz6ZRcmT9NCWhhw6eo2Huv"],
          },
          media: {
            mimeType: file.mimetype,
            body: fs.createReadStream(filePath),
          },
        });

        const fileId = response.data.id;

        const permissionResponse = await drive.permissions.create({
          fileId: fileId,
          requestBody: {
            role: "reader",
            type: "anyone",
          },
          fields: "id",
        });

        console.log("Permission response:", permissionResponse.data);

        // Remove the file from the local server after upload
        await unlinkFile(filePath);

        res.status(200).json({ fileId: fileId });
      } catch (error) {
        console.error("Error uploading to Google Drive:", error);
        res.status(500).send("Upload failed");
      }
    } else if (!err && req.files.length === 0) {
      res.statusMessage = "Please select an image to upload";
      res.status(400).end();
    } else {
      res.statusMessage =
        err === "Please upload images only"
          ? err
          : "Photo exceeds limit of 2MB";
      res.status(400).end();
    }
  });
});

app.put("/delete", async (req, res) => {
  const deleteImageIds = req.body.deleteImageIds; // Expecting Google Drive file IDs

  if (!deleteImageIds || deleteImageIds.length === 0) {
    res.statusMessage = "No images to delete";
    res.status(400).end();
    return;
  }

  try {
    for (const fileId of deleteImageIds) {
      console.log(`Deleting file with ID: ${fileId}`);
      await drive.files.delete({ fileId: fileId });
    }

    res.statusMessage = "Successfully deleted";
    res.status(200).end();
  } catch (error) {
    console.error("Error deleting images from Google Drive:", error);
    res.status(500).send("Failed to delete images");
  }
});

app.get("/gallery", async (req, res) => {
  try {
    const response = await drive.files.list({
      q: "'1ZPREpiTanEQz6ZRcmT9NCWhhw6eo2Huv' in parents and mimeType contains 'image/'", // Get only images
      fields: "files(id, name)",
    });

    const images = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      url: `https://drive.google.com/uc?export=view&id=${file.id}`, // Publicly accessible URL
    }));

    res.render("gallery", { images: images });
  } catch (error) {
    console.error("Error fetching images from Google Drive:", error);
    res.status(500).send("Failed to load gallery");
  }
});

// Run server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
