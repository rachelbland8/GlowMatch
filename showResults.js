function showResults() {
  const results = calculateResults();
  localStorage.setItem("skinQuizResult", JSON.stringify(results));
  window.location.href = "camera.html";
}