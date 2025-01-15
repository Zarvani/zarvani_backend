const setToken = (user, statusCode, res) => {
    const auth_token = user.getJwTToken();
    const refresh_token = user.getJwTRefreshToken();

   
    const cookieExpireDays = parseInt(process.env.COOKIE_EXPIRE, 10);
    const refreshExpireDays = parseInt(process.env.JWT_REFRESH_EXPIRE, 10);

    if (isNaN(cookieExpireDays) || isNaN(refreshExpireDays)) {
        throw new Error("Invalid expiration time values in environment variables.");
    }

    const options = {
        expires: new Date(Date.now() + cookieExpireDays * 24 * 60 * 60 * 1000), // Access token expiration
        httpOnly: true,
    };

    const refreshOptions = {
        expires: new Date(Date.now() + refreshExpireDays * 24 * 60 * 60 * 1000), // Refresh token expiration
        httpOnly: true,
        sameSite: 'Strict',
    };

    res.status(statusCode)
        .cookie("auth_token", auth_token, options)
        .cookie("refresh_token", refresh_token, refreshOptions)
        .json({
            success: true,
            user,
            auth_token,
            refresh_token,
            message: "Logged in successfully",
        });
};

module.exports = setToken;
