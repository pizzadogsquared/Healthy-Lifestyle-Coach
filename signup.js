import fs from "fs";

export function handleSignup(req, res) {
  const { name, email, password, confirm_password } = req.body;

  // Validate that the passwords match
  if (password !== confirm_password) {
    return res.render("signup", { error: "Passwords do not match." });
  }

  fs.readFile("users.txt", "utf8", (err, data) => {
    if (err) {
      console.log(err);
      return res.send("Error reading user data");
    }

    // Parse users safely (supports both old 3-field and new 5-field lines)
    const users = data
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split("/");
        const [uName, uEmail, uPassword] = parts;
        return { name: uName, email: uEmail, password: uPassword };
      });

    // Check if the email already exists
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.render("signup", { error: "Email is already registered." });
    }

    // ✅ New format: name/email/password/currentStreak/lastCheckInDate
    const newUserLine = `${name}/${email}/${password}/0/\n`;

    fs.appendFile("users.txt", newUserLine, err => {
      if (err) {
        console.log(err);
        return res.send("Error saving user data");
      }
      // Redirect to login after saving the new user
      res.redirect("/login");
    });
  });
}
