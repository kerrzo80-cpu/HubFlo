import Foundation

struct FieldRecordSummary: Decodable, Identifiable, Equatable {
    var id: String
    var type: String
    var ref: String
    var title: String
    var customer: String
    var site: String
    var description: String
    var status: String
    var value: Double
    var projectId: String?
    var uploadTargetId: String

    var typeLabel: String {
        type == "job" ? "Job" : "Quote"
    }

    var displayTitle: String {
        "\(ref) · \(customer)"
    }
}

struct NeXaAPIClient {
    private struct EndpointConfig {
        var baseURL: String
        var username: String
        var password: String
    }

    private func endpointConfig(baseURL: String, username: String, password: String) throws -> EndpointConfig {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else {
            throw NeXaAPIError.missingBaseURL
        }

        guard var components = URLComponents(string: trimmed) else {
            throw NeXaAPIError.invalidURL
        }

        let embeddedUsername = components.user?.removingPercentEncoding ?? ""
        let embeddedPassword = components.password?.removingPercentEncoding ?? ""
        components.user = nil
        components.password = nil

        guard let cleanURL = components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) else {
            throw NeXaAPIError.invalidURL
        }

        return EndpointConfig(
            baseURL: cleanURL,
            username: username.isEmpty ? embeddedUsername : username,
            password: password.isEmpty ? embeddedPassword : password
        )
    }

    private func applyAuthentication(to request: inout URLRequest, config: EndpointConfig) {
        if !config.username.isEmpty || !config.password.isEmpty {
            let token = Data("\(config.username):\(config.password)".utf8).base64EncodedString()
            request.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    func searchFieldRecords(
        query: String,
        baseURL: String,
        username: String,
        password: String
    ) async throws -> [FieldRecordSummary] {
        let config = try endpointConfig(baseURL: baseURL, username: username, password: password)

        guard var components = URLComponents(string: "\(config.baseURL)/api/field-records") else {
            throw NeXaAPIError.invalidURL
        }
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: "8"),
        ]
        guard let url = components.url else {
            throw NeXaAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Manager", forHTTPHeaderField: "x-hubflo-role")
        applyAuthentication(to: &request, config: config)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NeXaAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            switch httpResponse.statusCode {
            case 401:
                throw NeXaAPIError.unauthorised
            case 403:
                throw NeXaAPIError.forbidden
            default:
                throw NeXaAPIError.server(httpResponse.statusCode, message)
            }
        }

        return try JSONDecoder().decode([FieldRecordSummary].self, from: data)
    }

    func uploadRoomScan(
        _ payload: RoomPlanPayload,
        baseURL: String,
        projectId: String,
        username: String,
        password: String
    ) async throws -> RoomScanUploadResponse {
        let config = try endpointConfig(baseURL: baseURL, username: username, password: password)

        let encodedProjectId = projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId
        guard let url = URL(string: "\(config.baseURL)/api/takeoff-projects/\(encodedProjectId)/room-scans") else {
            throw NeXaAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Manager", forHTTPHeaderField: "x-hubflo-role")
        request.setValue(payload.actor, forHTTPHeaderField: "x-hubflo-employee-id")
        applyAuthentication(to: &request, config: config)

        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NeXaAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            switch httpResponse.statusCode {
            case 401:
                throw NeXaAPIError.unauthorised
            case 403:
                throw NeXaAPIError.forbidden
            case 404:
                throw NeXaAPIError.projectNotFound(projectId)
            default:
                throw NeXaAPIError.server(httpResponse.statusCode, message)
            }
        }

        return try JSONDecoder().decode(RoomScanUploadResponse.self, from: data)
    }
}

struct RoomScanUploadResponse: Decodable {
    var project: ProjectSummary?
    var document: DocumentSummary?
    var quoteAttachment: QuoteAttachmentSummary?
    var imported: ImportedSummary

    struct ProjectSummary: Decodable {
        var id: String
        var reference: String
        var name: String
    }

    struct DocumentSummary: Decodable {
        var id: String
        var fileName: String
        var previewImageDataUrl: String?
    }

    struct QuoteAttachmentSummary: Decodable {
        var quote: QuoteSummary?
    }

    struct QuoteSummary: Decodable {
        var id: String
        var ref: String
    }

    struct ImportedSummary: Decodable {
        var rooms: Int
        var measurements: Int
    }
}

enum NeXaAPIError: LocalizedError {
    case missingBaseURL
    case invalidURL
    case invalidResponse
    case unauthorised
    case forbidden
    case projectNotFound(String)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .missingBaseURL:
            return "Enter the NeXa web address before uploading."
        case .invalidURL:
            return "The NeXa web address is not valid."
        case .invalidResponse:
            return "NeXa did not return a valid response."
        case .unauthorised:
            return "NeXa rejected the scan. Check the pilot username and password in scanner settings."
        case .forbidden:
            return "NeXa received the scan but this app is not allowed to create or edit takeoff data."
        case .projectNotFound(let projectId):
            return "NeXa could not find project \(projectId). Open the scanner from the survey page so it links to the right project."
        case .server(let statusCode, let message):
            return "NeXa rejected the scan with HTTP \(statusCode): \(message)"
        }
    }
}
