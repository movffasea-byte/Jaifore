const express = require('express');
const cors = require('cors');



const app = express();
const PORT = process.env.PORT || 5000;


//PRODUCTS
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});