const deviceNameFromUserAgent = (userAgent = '') => {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua)
    ? 'Microsoft Edge'
    : /Chrome\//.test(ua)
      ? 'Google Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const platform = /iPhone|iPad/.test(ua)
    ? 'iOS device'
    : /Android/.test(ua)
      ? 'Android device'
      : /Windows/.test(ua)
        ? 'Windows device'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux device'
            : 'Unknown device';
  return `${browser} on ${platform}`;
};

module.exports = { deviceNameFromUserAgent };
